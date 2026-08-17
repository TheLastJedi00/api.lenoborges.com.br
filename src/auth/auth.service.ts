import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { FirebaseService } from './firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';
import { Profile } from '../profile/entities/profile.entity';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session.dto';
import { normalizeEmail } from '../common/normalize';

/** Resposta do accounts:signInWithPassword (camelCase, Identity Toolkit). */
interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email?: string;
}

/** Resposta do securetoken (snake_case, outra API do Google). */
interface RefreshResponse {
  id_token: string;
  refresh_token: string;
  expires_in: string;
  user_id: string;
}

/** Codigo do Admin SDK para e-mail que ja tem conta. E o unico erro esperado no cadastro. */
const EMAIL_ALREADY_EXISTS = 'auth/email-already-exists';

function isExpected(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

/** Mensagem legivel para log, sem despejar objeto de erro inteiro. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Para onde a tela de senha do Firebase devolve o usuario.
   *
   * Nao e o destino do link do e-mail: esse e a tela hospedada pelo Google, e
   * nao passa por aqui. Este valor vira o botao de retorno que ela exibe depois
   * de a senha ser aceita. Sem ele o cadastro termina numa pagina do Google, sem
   * caminho de volta para o produto.
   *
   * O `?entrar=1` existe porque o login do front e um dialogo na landing, nao
   * uma rota: e o parametro que manda a landing abrir o dialogo.
   */
  private readonly continueUrl: string;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly profileRepository: ProfileRepository,
    private readonly waitlistRepository: WaitlistRepository,
    private readonly configService: ConfigService,
  ) {
    // FRONTEND_URL aceita lista separada por virgula, porque o CORS em
    // src/main.ts permite mais de uma origem. O retorno tem um destino so: a
    // primeira da lista.
    const frontendUrl = this.configService
      .getOrThrow<string>('FRONTEND_URL')
      .split(',')[0]
      .trim()
      .replace(/\/+$/, '');

    this.continueUrl = `${frontendUrl}/?entrar=1`;
  }

  async signup(dto: SignupDto): Promise<{ status: 'confirmation_sent' }> {
    const normalizedEmail = normalizeEmail(dto.email);
    const normalizedConfirmation = normalizeEmail(dto.emailConfirmation);

    if (normalizedEmail !== normalizedConfirmation) {
      throw new BadRequestException('E-mails não conferem');
    }

    try {
      const user = await this.firebase.auth.createUser({
        email: normalizedEmail,
        // Senha aleatoria, descartada nesta linha e nunca conhecida por
        // ninguem. createUser({ email }) sozinho cria um usuario sem provedor de
        // senha, e pedir PASSWORD_RESET para uma conta nesse estado e caminho
        // nao garantido: o Identity Toolkit trata reset como operacao sobre uma
        // credencial que deveria existir.
        password: randomBytes(32).toString('base64url'),
        emailVerified: false,
      });

      await this.createProfileFor(user.uid, normalizedEmail);
    } catch (error) {
      // E-mail ja cadastrado cai aqui e segue adiante de proposito: responder
      // diferente para e-mail conhecido transformaria o cadastro em oraculo de
      // enumeracao. Quem ja tem conta recebe outro link de definir senha.
      //
      // Qualquer outro erro tambem e engolido -- a resposta precisa ser
      // identica -- mas vai para o log. Engolir em silencio absoluto foi o que
      // escondeu o UNAUTHORIZED_DOMAIN por um deploy inteiro: o cadastro
      // respondia 202 e ninguem recebia nada. Ver fix.md, Fix 2.
      if (!isExpected(error, EMAIL_ALREADY_EXISTS)) {
        this.logger.error(
          `Falha ao criar usuario no signup: ${describe(error)}`,
        );
      }
    }

    try {
      await this.firebase.identityToolkit('sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email: normalizedEmail,
        continueUrl: this.continueUrl,
      });
    } catch (error) {
      // Mesmo motivo: falha de envio nao pode virar sinal sobre a existencia da
      // conta. Mas aqui nao ha erro esperado nenhum -- se esta chamada falha, o
      // membro simplesmente nao recebe o link, e isso e sempre defeito.
      //
      // UNAUTHORIZED_DOMAIN e o suspeito numero um: o dominio do continueUrl
      // precisa estar em Authentication > Settings > Authorized domains, e
      // localhost ja vem autorizado de fabrica -- o que faz o problema existir
      // so em producao.
      this.logger.error(
        `Falha ao enviar o e-mail de definir senha (continueUrl=${this.continueUrl}): ${describe(error)}`,
      );
    }

    return { status: 'confirmation_sent' };
  }

  async login(
    dto: LoginDto,
  ): Promise<{ session: SessionResponseDto; refreshToken: string }> {
    const normalizedEmail = normalizeEmail(dto.email);

    let data: SignInResponse;
    try {
      // O Admin SDK nao verifica senha. A chamada acontece no servidor, com a
      // Web API Key, para manter a decisao da spec 005 de o front nunca falar
      // com o provedor de auth.
      data = await this.firebase.identityToolkit<SignInResponse>(
        'signInWithPassword',
        {
          email: normalizedEmail,
          password: dto.password,
          returnSecureToken: true,
        },
      );
    } catch {
      // INVALID_LOGIN_CREDENTIALS, EMAIL_NOT_FOUND e USER_DISABLED viram a mesma
      // resposta: distinguir entregaria quais e-mails existem.
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const profile = await this.ensureProfile(data.localId, normalizedEmail);

    return {
      session: {
        accessToken: data.idToken,
        // expiresIn vem como string em segundos; o contrato do front e numero.
        expiresIn: Number(data.expiresIn),
        user: { id: data.localId, email: data.email ?? normalizedEmail },
        profileCompleted: profile.completedAt !== null,
        grade: profile.grade,
      },
      refreshToken: data.refreshToken,
    };
  }

  async refresh(
    refreshToken?: string,
  ): Promise<{ session: SessionResponseDto; refreshToken: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }

    let data: RefreshResponse;
    try {
      data = await this.firebase.secureToken<RefreshResponse>({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    } catch {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }

    // O securetoken devolve user_id, nao o e-mail. Ele vem do Admin SDK.
    const user = await this.firebase.auth.getUser(data.user_id);
    const email = user.email ? normalizeEmail(user.email) : '';
    const profile = await this.ensureProfile(data.user_id, email);

    return {
      session: {
        accessToken: data.id_token,
        expiresIn: Number(data.expires_in),
        user: { id: data.user_id, email },
        profileCompleted: profile.completedAt !== null,
        grade: profile.grade,
      },
      refreshToken: data.refresh_token,
    };
  }

  /**
   * Encerra a sessao do refresh token que veio no cookie.
   *
   * ATENCAO, mudanca de comportamento na spec 007: **o logout e global.** O
   * Firebase revoga refresh tokens por usuario, nao por sessao, e nao existe
   * equivalente ao escopo `local` que a spec 005 escolheu de proposito. Sair no
   * computador do laboratorio passa a deslogar a mesma pessoa no celular dela.
   * O escopo por sessao foi perdido junto com o fornecedor; nao ha contorno.
   *
   * A revogacao invalida a renovacao, nao os ID tokens ja emitidos: um deles
   * continua valido ate expirar, em no maximo uma hora, a menos que o guard
   * pague um checkRevoked por requisicao. Ver o comentario em
   * firebase-auth.guard.ts.
   *
   * Cookie ausente, forjado ou expirado nao revoga nada e mesmo assim resolve:
   * logout e idempotente, o objetivo e o estado final "deslogado".
   */
  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    try {
      // O UID nao esta no cookie: o refresh token e opaco. Troca-lo e o unico
      // jeito de descobrir de quem e a sessao que esta saindo.
      const data = await this.firebase.secureToken<RefreshResponse>({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      await this.firebase.auth.revokeRefreshTokens(data.user_id);
    } catch {
      // Idempotente: falha de rede nao pode prender o usuario dentro da conta.
    }
  }

  /**
   * Garante que existe perfil para o UID, criando na hora se faltar.
   *
   * Cobre quem se cadastrou antes de haver documento, e o caso em que o signup
   * criou o usuario mas falhou ao gravar o perfil. Existia na spec 005 pelo
   * mesmo motivo e continua valendo.
   */
  private async ensureProfile(uid: string, email: string): Promise<Profile> {
    const existing = await this.profileRepository.findById(uid);
    if (existing.found && existing.entry) {
      return existing.entry;
    }

    const created = await this.createProfileFor(uid, email);
    return created;
  }

  private async createProfileFor(uid: string, email: string): Promise<Profile> {
    const waitlist = email
      ? await this.waitlistRepository.findByEmail(email)
      : { found: false, entry: undefined };
    const waitlistEntry =
      waitlist.found && waitlist.entry ? waitlist.entry : null;

    const created = await this.profileRepository.create({
      id: uid,
      name: waitlistEntry ? waitlistEntry.name : null,
      phone: waitlistEntry ? waitlistEntry.phone : null,
      bio: null,
      // Nasce sem insignia. Antes era 1, quando o primeiro grau significava
      // "estar aqui"; com insignias, nascer com uma seria dar conquista de graca.
      grade: 0,
      completedAt: null,
      // O ID da inscricao e o e-mail normalizado, que e o caminho do documento
      // em waitlist_entries. Ver a decisao 6 da spec 007.
      waitlistEntryId: waitlistEntry ? waitlistEntry.id : null,
    });

    return created.entry;
  }
}
