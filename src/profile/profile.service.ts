import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ProfileDto } from './dto/profile.dto';
import type { UserRole } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../auth/firebase.service';
import {
  normalizeName,
  normalizePhone,
  normalizeBio,
  normalizeEmail,
} from '../common/normalize';

/**
 * Recusa unica das operacoes de e-mail.
 *
 * **E a mesma mensagem para e-mail invalido, e-mail igual ao atual e e-mail que
 * ja pertence a outra conta** (spec 013, decisao 3). O Identity Toolkit devolve
 * `EMAIL_EXISTS` no ultimo caso e essa informacao nao sai daqui: um endpoint que
 * responde "esse e-mail ja existe" e um oraculo de enumeracao atras de um login,
 * e login e barato de conseguir. A spec 005 fechou esse oraculo no cadastro
 * pagando o preco de responder 202 para e-mail conhecido; reabri-lo aqui em nome
 * da UX desfaz aquela decisao sem citar ela.
 */
const EMAIL_REJECTED = 'Não foi possível usar este e-mail.';

/**
 * Traduz a recusa de senha do Identity Toolkit.
 *
 * O piso real e a politica do console (Authentication > Settings > Password
 * policy), nao o `@MinLength` do DTO: o Google recusa a senha fraca mesmo
 * quando o decorator deixou passar, e e esta mensagem que a pessoa le.
 */
function translatePasswordError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);

  if (code.startsWith('WEAK_PASSWORD') || code.startsWith('PASSWORD_DOES')) {
    return 'A nova senha não atende à política de segurança do projeto.';
  }
  if (code.startsWith('TOKEN_EXPIRED') || code.startsWith('INVALID_ID_TOKEN')) {
    return 'Sessão expirada. Entre de novo e tente outra vez.';
  }

  return 'Não foi possível trocar a senha.';
}

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly repository: ProfileRepository,
    private readonly firebase: FirebaseService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  async getProfile(
    userId: string,
    email: string,
    role: UserRole | null,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    return {
      id: profile.entry.id,
      email,
      name: profile.entry.name,
      phone: profile.entry.phone,
      bio: profile.entry.bio,
      grade: profile.entry.grade,
      linkedin: profile.entry.linkedin,
      instagram: profile.entry.instagram,
      profileCompleted: profile.entry.completedAt !== null,
      role,
      tier: profile.entry.tier,
    };
  }

  /**
   * Pede a troca do e-mail de acesso.
   *
   * **Este endpoint nao troca o e-mail.** Ele reautentica e pede ao Identity
   * Toolkit um `sendOobCode` com `VERIFY_AND_CHANGE_EMAIL`; quem troca e o
   * Google, quando o link for clicado. O `oobCode` nao passa por esta API e nao
   * existe tela nossa que o consuma -- e a decisao 3 da spec 007 aplicada de
   * novo (spec 013, decisao 2).
   *
   * **A confirmacao vai para o endereco novo, nao para o antigo**, e essa ordem
   * e o ponto inteiro: confirmar na caixa velha provaria que a pessoa ainda tem
   * a caixa que esta abandonando. A alternativa -- `auth.updateUser({ email })`
   * pelo Admin SDK -- trocaria o acesso na hora, sem ninguem provar nada, e um
   * erro de digitacao viraria uma conta inalcancavel.
   */
  async changeEmail(
    userId: string,
    currentEmail: string,
    dto: ChangeEmailDto,
  ): Promise<{ status: 'confirmation_sent' }> {
    const newEmail = normalizeEmail(dto.newEmail);

    // Antes de qualquer ida ao Firebase: disparar confirmacao para o endereco em
    // que a pessoa ja esta e gastar um e-mail para nao mudar nada.
    if (newEmail === normalizeEmail(currentEmail)) {
      throw new BadRequestException(EMAIL_REJECTED);
    }

    // Reautenticar vem primeiro, sempre: senha errada nao pode disparar e-mail
    // nenhum, ou o endpoint vira um jeito de mandar mensagem para terceiros.
    const idToken = await this.authService.reauthenticate(
      currentEmail,
      dto.password,
    );

    try {
      await this.firebase.identityToolkit('sendOobCode', {
        requestType: 'VERIFY_AND_CHANGE_EMAIL',
        idToken,
        newEmail,
        continueUrl: this.authService.continueUrl,
      });
    } catch (error) {
      // EMAIL_EXISTS, INVALID_NEW_EMAIL e o resto viram a mesma recusa. O motivo
      // real fica no log, onde nao e oraculo de nada.
      this.logger.warn(
        `Falha ao pedir a troca de e-mail do usuario ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException(EMAIL_REJECTED);
    }

    return { status: 'confirmation_sent' };
  }

  /**
   * Troca a senha e **encerra a sessao**, nessa ordem.
   *
   * Encerrar nao e efeito colateral: trocar a senha porque se desconfia de
   * invasao e continuar com o invasor logado e nao ter trocado a senha (spec
   * 013, decisao 4).
   *
   * **Nao ha rotacao do par de tokens, e o motivo e mecanico**: o cookie de
   * refresh vive em `path=/auth` (spec 005), entao uma resposta de `/me` nao
   * consegue le-lo para rotaciona-lo. Da para apaga-lo daqui -- `Set-Cookie`
   * escreve qualquer path --, mas nao para emitir um par novo. Entre mudar o
   * path do cookie do produto inteiro por causa desta tela e encerrar a sessao,
   * encerrar ja era a saida certa por seguranca.
   *
   * **A revogacao nao e corte imediato.** O ID token que a pessoa tem na mao
   * continua valido por ate uma hora, porque o guard roda com
   * `CHECK_REVOKED = false` (decisao 2 da spec 007). A janela e conhecida e e o
   * preco ja aceito la; quem ler "revogou" e assumir corte imediato erra a conta
   * de risco. Se um dia houver requisito de corte na hora, e aquele booleano que
   * vira.
   *
   * Quem limpa o cookie e o controller, que e quem tem a `Response`.
   */
  async changePassword(
    userId: string,
    email: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    // Reautenticar antes de tudo: revogar antes de conferir deslogaria em todo
    // aparelho quem so errou de digitacao.
    const idToken = await this.authService.reauthenticate(
      email,
      dto.currentPassword,
    );

    try {
      await this.firebase.identityToolkit('update', {
        idToken,
        password: dto.newPassword,
        returnSecureToken: false,
      });
    } catch (error) {
      // Aqui a mensagem do Google vale traduzida, e nao engolida: a politica de
      // senha do console e que decide o piso, e quem trocou a senha precisa
      // saber por que ela foi recusada. Nao ha oraculo nenhum a proteger --
      // quem chegou nesta linha ja provou a senha atual.
      throw new BadRequestException(translatePasswordError(error));
    }

    // Mata toda sessao viva, em qualquer aparelho.
    await this.firebase.auth.revokeRefreshTokens(userId);
  }

  async updateProfile(
    userId: string,
    email: string,
    role: UserRole | null,
    dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    const normalizedName = normalizeName(dto.name);
    const normalizedPhone = normalizePhone(dto.phone);
    const normalizedBio = normalizeBio(dto.bio);

    if (normalizedBio.length < 10 || normalizedBio.length > 500) {
      throw new BadRequestException('Bio deve ter entre 10 e 500 caracteres.');
    }

    const patchData: {
      name: string;
      phone: string;
      bio: string;
      linkedin?: string | null;
      instagram?: string | null;
      completedAt?: Date;
    } = {
      name: normalizedName,
      phone: normalizedPhone,
      bio: normalizedBio,
    };

    // **Campo ausente no corpo nao apaga o valor guardado.** O DTO ja traduziu
    // string vazia em `null`, entao o que chega aqui como `undefined` e
    // "nao mencionei" -- e "nao mencionei" nunca entra no patch. E a diferenca
    // que todo update parcial erra quando ninguem escreve o teste.
    if (dto.linkedin !== undefined) {
      patchData.linkedin = dto.linkedin;
    }
    if (dto.instagram !== undefined) {
      patchData.instagram = dto.instagram;
    }

    if (!profile.entry.completedAt) {
      patchData.completedAt = new Date();
    }

    const updated = await this.repository.update(userId, patchData);

    return {
      id: updated.entry.id,
      email,
      name: updated.entry.name,
      phone: updated.entry.phone,
      bio: updated.entry.bio,
      grade: updated.entry.grade,
      linkedin: updated.entry.linkedin,
      instagram: updated.entry.instagram,
      profileCompleted: updated.entry.completedAt !== null,
      role,
      tier: updated.entry.tier,
    };
  }
}
