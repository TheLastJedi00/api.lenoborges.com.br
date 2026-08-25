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
