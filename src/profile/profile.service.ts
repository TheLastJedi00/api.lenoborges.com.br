import {
  ForbiddenException,
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
import { DeleteAccountDto } from './dto/delete-account.dto';
import { EmailPreferenceDto } from './dto/email-preference.dto';
import { PrivacyPreferenceDto } from './dto/privacy-preference.dto';
import { ProfileDto } from './dto/profile.dto';
import { PublicMemberDto } from './dto/public-member.dto';
import { WatchedVideoRepository } from '../track/watched-video.repository';
import { LegalService } from '../legal/legal.service';
import { LegalAcceptanceRepository } from '../legal/legal-acceptance.repository';
import type { Profile } from './entities/profile.entity';
import type { UserRole } from '../auth/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { MuralRepository } from '../mural/mural.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
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
    @Inject(forwardRef(() => MuralRepository))
    private readonly muralRepository: MuralRepository,
    private readonly waitlistRepository: WaitlistRepository,
    @Inject(forwardRef(() => LegalService))
    private readonly legalService: LegalService,
    private readonly legalAcceptanceRepository: LegalAcceptanceRepository,
    @Inject(forwardRef(() => WatchedVideoRepository))
    private readonly watchedVideoRepository: WatchedVideoRepository,
  ) {}

  /**
   * A montagem do `ProfileDto`, num lugar so.
   *
   * Ela vivia duplicada em `getProfile` e `updateProfile`, e a spec 018 seria a
   * terceira e a quarta copia dos mesmos campos -- inclusive do `pendingLegal`,
   * que precisa sair identico nos dois. Duas montagens do mesmo DTO divergem no
   * primeiro campo novo, e a que fica velha e sempre a que menos gente le.
   */
  private toDto(
    profile: Profile,
    email: string,
    role: UserRole | null,
  ): ProfileDto {
    return {
      id: profile.id,
      email,
      name: profile.name,
      phone: profile.phone,
      bio: profile.bio,
      grade: profile.grade,
      linkedin: profile.linkedin,
      instagram: profile.instagram,
      emailOptOut: profile.emailOptOut,
      profileCompleted: profile.completedAt !== null,
      role,
      tier: profile.tier,
      // O XP (spec 019). Vem daqui, e nao da resposta de sessao: uma segunda
      // fonte para o mesmo valor diverge no primeiro check dado antes do
      // refresh, e o painel passaria a mostrar dois numeros conforme a rota.
      xp: profile.xp,
      // A posicao do interruptor. Sem ele no DTO, a tela de Meu Perfil chuta a
      // posicao inicial do switch -- e chuta ligado, que e o unico chute que
      // publica dado de alguem.
      socialLinksPublic: profile.socialLinksPublic,
      // **Do mesmo `pendingFor` que o guard usa** (spec 018, decisao 9). Nunca
      // calcular de outro jeito aqui: este campo e o corpo do 428 tem de dizer a
      // mesma coisa, ou o painel abre bloqueado por algo que ja foi aceito.
      pendingLegal: this.legalService.pendingFor(profile.legalAcceptances),
      // `?? {}` de novo, e nao e redundancia com o converter: o converter e o
      // unico produtor hoje, mas um perfil montado a mao -- num teste, num
      // script de migracao -- chegaria aqui sem o campo e derrubaria o `GET /me`
      // com um TypeError que nao menciona aceite nenhum.
      legalAcceptances: Object.fromEntries(
        Object.entries(profile.legalAcceptances ?? {}).map(
          ([id, acceptance]) => [
            id,
            {
              version: acceptance.version,
              acceptedAt: acceptance.acceptedAt.toISOString(),
            },
          ],
        ),
      ),
    };
  }

  async getProfile(
    userId: string,
    email: string,
    role: UserRole | null,
  ): Promise<ProfileDto> {
    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    return this.toDto(profile.entry, email, role);
  }

  /**
   * O cartao que um membro abre sobre outro (spec 019, decisao 8).
   *
   * **O mapeamento e campo a campo, de proposito.** Nao ha espalhamento de
   * objeto, nao ha reuso do `toDto` acima, e nao ha classe base compartilhada:
   * os tres seriam o caminho pelo qual o proximo campo do perfil -- telefone,
   * e-mail, `emailOptOut` -- vaza para a comunidade inteira sem ninguem ter
   * escolhido. Campo novo entra aqui por decisao escrita, e nao por
   * conveniencia.
   *
   * **404 tambem quando o onboarding nao terminou.** Perfil sem `completedAt` e
   * uma conta pela metade, sem nome e sem bio; um cartao dela seria um cartao
   * vazio, e responder 200 com nada e pior do que responder que nao ha. De
   * quebra, fecha a enumeracao de contas em criacao.
   *
   * **O corte das redes acontece aqui, no servidor** (decisao 9). Um front que
   * recebesse o link e decidisse nao desenha-lo ja o teria entregado a quem
   * abrisse a aba de rede.
   */
  async findPublicMember(uid: string): Promise<PublicMemberDto> {
    const profile = await this.repository.findById(uid);
    if (!profile.found || !profile.entry || !profile.entry.completedAt) {
      throw new NotFoundException('Membro não encontrado.');
    }

    const member = profile.entry;
    const showLinks = member.socialLinksPublic;

    return {
      id: member.id,
      name: member.name,
      bio: member.bio,
      grade: member.grade,
      xp: member.xp,
      linkedin: showLinks ? member.linkedin : null,
      instagram: showLinks ? member.instagram : null,
    };
  }

  /**
   * O interruptor das redes sociais (spec 019, decisao 9).
   *
   * Mesmo desenho do `setEmailPreference`: uma rota propria, um campo so, e a
   * gravacao no clique. **Nao passa pelo `PATCH /me/profile`**, que exige nome,
   * telefone e bio -- um interruptor que exige reenviar o cadastro inteiro e um
   * interruptor que ninguem liga.
   */
  async setPrivacyPreference(
    userId: string,
    dto: PrivacyPreferenceDto,
  ): Promise<void> {
    const { found } = await this.repository.setSocialLinksPublic(
      userId,
      dto.socialLinksPublic,
    );

    if (!found) {
      throw new NotFoundException('Perfil não encontrado.');
    }
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

  /**
   * Exclui a conta. **Imediata, irreversivel, e sem lixeira.**
   *
   * A exclusao tem duas metades (spec 013, decisao 6). Some de verdade: o
   * usuario do Firebase Auth, `profiles/{uid}`, a subcolecao
   * `notification_reads`, os votos dados e a entrada na lista de espera. Vira
   * anonimo: as perguntas do Mural de autoria dela -- porque elas tem votos de
   * outras pessoas e podem ter virado video na trilha.
   *
   * **A ordem e fixa e o Auth e o ultimo a morrer** (decisao 9). Nao existe
   * transacao atravessando Firestore e Firebase Auth, entao o que da para
   * escolher e qual metade fica de pe quando a outra falha. Com o Auth por
   * ultimo, uma falha no meio deixa a conta viva e a pessoa capaz de tentar de
   * novo. Com o Auth primeiro, deixa dado pessoal orfao no Firestore -- sem
   * conta, sem sessao e sem ninguem com direito de pedir a remocao --, que e o
   * pior resultado possivel da operacao cujo proposito inteiro e remover dado
   * pessoal.
   *
   * No dia em que houver gateway de pagamento, **cancelar a cobranca entra
   * aqui, antes do `deleteUser`**.
   */
  async deleteAccount(
    userId: string,
    email: string,
    role: UserRole | null,
    dto: DeleteAccountDto,
  ): Promise<void> {
    // **Antes da reautenticacao**, para o admin nao gastar a senha descobrindo
    // que nao podia. Nao e protecao de seguranca, e trava contra tijolo: a claim
    // `role` e aplicada a mao pelo console (spec 009), e um admin que se exclui
    // leva junto a unica forma de administrar o produto -- devolver isso exige
    // console do Firebase, service account e alguem que saiba o caminho. Esta no
    // backend porque o front esconder o botao seria protecao nenhuma.
    if (role === 'admin') {
      throw new ForbiddenException(
        'Contas de administração não podem ser excluídas por aqui.',
      );
    }

    const profile = await this.repository.findById(userId);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    await this.authService.reauthenticate(email, dto.password);

    // 2. As perguntas viram anonimas: o texto e os votos de terceiros ficam.
    await this.muralRepository.anonymizeAuthor(userId);

    // 3. Os votos dados saem, e os contadores acompanham no mesmo lote.
    await this.muralRepository.removeVotesBy(userId);

    // 4. As subcolecoes, e so entao o perfil. **Subcolecao nao some com o pai no
    // Firestore** -- terceira vez que este produto esbarra nisso, depois dos
    // votos do Mural e de `notification_reads` (spec 018, decisao 11). O aceite
    // e dado pessoal, a pessoa pediu para ser esquecida, e o contrato que ele
    // comprova terminou junto com a conta.
    // E o razao do que ela assistiu (spec 019, decisao 13): historico de
    // comportamento ligado a um `uid`. A pessoa pediu para ser esquecida, e o
    // que ela assistiu vai junto.
    await this.legalAcceptanceRepository.removeAll(userId);
    await this.watchedVideoRepository.removeAll(userId);
    await this.repository.remove(userId);

    // 5. A inscricao na lista de espera, que e nome, telefone e e-mail crus.
    if (profile.entry.waitlistEntryId) {
      await this.waitlistRepository.remove(profile.entry.waitlistEntryId);
    }

    // 6. O Auth por ultimo. Nada depois desta linha pode falhar de um jeito que
    // importe: o que vem depois e cookie e status.
    await this.firebase.auth.deleteUser(userId);
  }

  /**
   * O interruptor de e-mail do próprio membro (spec 014, decisão 8).
   *
   * É o mesmo campo que o link do rodapé escreve, e por isso o mesmo método do
   * repositório: dois caminhos até o mesmo opt-out, e um só lugar que o grava.
   * O motivo é sempre `membro` — quem chega aqui está logado e pediu.
   */
  async setEmailPreference(
    userId: string,
    dto: EmailPreferenceDto,
  ): Promise<void> {
    const { found } = await this.repository.setEmailOptOut(
      userId,
      !dto.receber,
      'membro',
    );

    if (!found) {
      throw new NotFoundException('Perfil não encontrado.');
    }
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

    return this.toDto(updated.entry, email, role);
  }
}
