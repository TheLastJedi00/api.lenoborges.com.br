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
import { roleOf } from './role';
import { translateOobError, translatePasswordError } from './password-errors';

/** Resposta do accounts:signInWithPassword (camelCase, Identity Toolkit). */
interface SignInResponse {
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  localId: string;
  email?: string;
}

/**
 * Resposta das operacoes de oobCode (accounts:resetPassword e accounts:update).
 *
 * O `requestType` vem e nao e usado: quem escolhe a tela e o `mode` da URL, e
 * ter duas fontes para a mesma informacao e ter duas para divergirem.
 */
interface OobCodeResponse {
  email: string;
  requestType?: string;
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
   *
   * Publico porque a troca de e-mail (spec 013) dispara outro `sendOobCode` e
   * precisa do mesmo destino de retorno. Um segundo calculo do mesmo endereco
   * seria um segundo lugar para esquecer de autorizar o dominio.
   */
  readonly continueUrl: string;

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

    // O signInWithPassword nao devolve as custom claims, entao o papel sai do
    // Admin SDK. As duas idas correm juntas de proposito: em serie, o login
    // pagaria a latencia das duas somadas por um campo que so decide se o front
    // desenha um botao.
    const [profile, user] = await Promise.all([
      this.ensureProfile(data.localId, normalizedEmail),
      this.firebase.auth.getUser(data.localId),
    ]);

    return {
      session: {
        accessToken: data.idToken,
        // expiresIn vem como string em segundos; o contrato do front e numero.
        expiresIn: Number(data.expiresIn),
        user: { id: data.localId, email: data.email ?? normalizedEmail },
        profileCompleted: profile.completedAt !== null,
        grade: profile.grade,
        role: roleOf(user),
        tier: profile.tier,
      },
      refreshToken: data.refreshToken,
    };
  }

  /**
   * Confere a senha atual de quem ja esta logado, e devolve um ID token fresco.
   *
   * **E o unico lugar do projeto capaz de dizer "essa senha confere" alem do
   * login -- e e o mesmo lugar**: bate no mesmo `accounts:signInWithPassword`.
   * Um verificador proprio seria o segundo, e dois verificadores divergem na
   * primeira excecao (spec 013, decisao 5).
   *
   * **O token devolvido nunca vira cookie e nunca vira `SessionResponseDto`.**
   * Ele e carga util, nao sessao: o `accounts:update` da troca de senha e o
   * `sendOobCode` da troca de e-mail exigem um token do usuario, e o que chega
   * no header pode estar a cinquenta minutos de idade. Quem "aproveitar" este
   * token para devolver sessao cria uma segunda porta de login, ao lado da que
   * ja existe e ja e testada.
   *
   * `INVALID_LOGIN_CREDENTIALS` e `EMAIL_NOT_FOUND` viram a **mesma** mensagem:
   * distinguir aqui responderia uma pergunta que nem quem ja esta logado
   * deveria conseguir fazer.
   */
  async reauthenticate(email: string, password: string): Promise<string> {
    try {
      const data = await this.firebase.identityToolkit<SignInResponse>(
        'signInWithPassword',
        {
          email: normalizeEmail(email),
          password,
          returnSecureToken: true,
        },
      );

      return data.idToken;
    } catch {
      throw new UnauthorizedException('Senha incorreta.');
    }
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
        role: roleOf(user),
        tier: profile.tier,
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
   * Confere um `oobCode` sem consumi-lo, e devolve o e-mail dono do link.
   *
   * `accounts:resetPassword` **so com o `oobCode`** e a chamada de conferencia
   * do Identity Toolkit: sem `newPassword` no corpo, ela valida o codigo e
   * responde de quem ele e, sem gasta-lo. Mandar a senha junto aqui trocaria a
   * senha de quem apenas abriu a tela.
   *
   * **Devolver o e-mail nao e o oraculo que o `signup` evita** (decisao 4), e a
   * diferenca esta em qual segredo prova o que: no `signup` o requisitante
   * fornece o e-mail e quer saber se ele existe -- responder e o oraculo. Aqui
   * ele fornece o `oobCode`, que so chegou por uma caixa de entrada, e portanto
   * ja sabe de qual e-mail se trata: foi nela que o link chegou. E o que a tela
   * do Firebase mostrava no lugar desta, e serve a quem tem duas contas ou
   * clicou num link antigo: ver **de qual** conta e a senha antes de digita-la.
   */
  async checkOobCode(oobCode: string): Promise<{ email: string }> {
    try {
      const data = await this.firebase.identityToolkit<OobCodeResponse>(
        'resetPassword',
        { oobCode },
      );

      return { email: data.email };
    } catch (error) {
      throw this.deadLink(error, 'checkOobCode');
    }
  }

  /**
   * Confirma a senha nova pelo `oobCode` do link do e-mail.
   *
   * **Nao devolve token, nao emite cookie e nao chama o `signInWithPassword`**,
   * mesmo sendo trivial faze-lo -- a senha nova esta no corpo da requisicao, e
   * um login logo depois seria uma linha. E a decisao 5 da spec 005: sessao
   * nasce no `POST /auth/login`, num caminho so. Um segundo emissor do cookie
   * de refresh seria exercitado apenas no cadastro, o fluxo que menos gente
   * percorre duas vezes, e portanto aquele em que um defeito de `SameSite` ou
   * de `Domain` ficaria escondido por mais tempo. A spec 011 e a memoria de
   * quanto custa descobrir isso tarde.
   *
   * O front manda a pessoa para `/?entrar=1` e ela entra com a senha que acabou
   * de criar -- o que e, de quebra, a prova de que ela e a senha que a pessoa
   * achou que digitou.
   *
   * **Nao ha `updateUser({ emailVerified: true })` a acrescentar** (decisao 9):
   * o proprio `accounts:resetPassword` marca `emailVerified`, porque quem
   * provou receber o e-mail provou ser dono dele. Forca-lo a mao transformaria
   * o cadastro num caminho em que ninguem prova nada.
   *
   * Dois ramos de erro distintos de proposito: link morto e senha recusada pela
   * politica do console sao coisas diferentes para quem esta na tela, e quem
   * teve a senha recusada precisa saber que foi por isso.
   */
  async confirmPassword(oobCode: string, newPassword: string): Promise<void> {
    try {
      await this.firebase.identityToolkit('resetPassword', {
        oobCode,
        newPassword,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);

      if (
        code.startsWith('WEAK_PASSWORD') ||
        code.startsWith('PASSWORD_DOES')
      ) {
        // A politica do console e que decide o piso (decisao 6). Nao ha oraculo
        // a proteger: quem chegou aqui ja provou ter a caixa de entrada.
        this.logger.warn(`Senha recusada pela politica do projeto: ${code}`);
        throw new BadRequestException(translatePasswordError(error));
      }

      throw this.deadLink(error, 'confirmPassword');
    }
  }

  /**
   * Aplica a acao de e-mail que o `oobCode` carrega, e devolve o e-mail final.
   *
   * Serve a `VERIFY_AND_CHANGE_EMAIL`, `VERIFY_EMAIL` e `RECOVER_EMAIL`, e
   * **quem decide qual deles e o proprio codigo** (decisao 3). Nao ha `switch`
   * de modo aqui: o `oobCode` carrega o proprio `requestType`, e o Firebase
   * recusa um codigo de reset usado como codigo de verificacao. Deixar essa
   * recusa acontecer no Google, e nao num `if` nosso, e ter uma regra em vez de
   * duas -- e a segunda seria escrita a partir do `mode` da query, que quem
   * manda o link escreve.
   *
   * O `requestType` que a resposta traz e ignorado (ponto em aberto 5): a tela
   * desenha o modo que veio na URL, e ter duas fontes para a mesma informacao e
   * ter duas para divergirem.
   */
  async applyEmailAction(oobCode: string): Promise<{ email: string }> {
    try {
      const data = await this.firebase.identityToolkit<OobCodeResponse>(
        'update',
        { oobCode },
      );

      return { email: data.email };
    } catch (error) {
      throw this.deadLink(error, 'applyEmailAction');
    }
  }

  /**
   * A recusa unica de link morto, com o codigo do Google indo para o log.
   *
   * O log e onde o codigo e diagnostico; a resposta e onde ele seria oraculo.
   * Mesma divisao que o `login` e o `changeEmail` ja fazem.
   */
  private deadLink(error: unknown, operacao: string): BadRequestException {
    this.logger.warn(`${operacao}: oobCode recusado — ${describe(error)}`);
    return new BadRequestException(translateOobError());
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
