import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { FirebaseService } from './firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';

/**
 * O caso 19 da versao anterior deste spec ("cada operacao de usuario pede um
 * cliente novo") saiu com o Supabase. Ele existia porque o cliente do
 * @supabase/auth-js guardava a sessao do ultimo usuario que passasse por ele,
 * mesmo com persistSession: false, e um signOut compartilhado derrubaria a
 * sessao errada. O Admin SDK do Firebase nao tem esse estado: as operacoes sao
 * requisicoes HTTP sem sessao acumulada, e nao ha o que isolar.
 */
describe('AuthService', () => {
  let service: AuthService;
  let firebase: {
    auth: {
      createUser: jest.Mock;
      getUser: jest.Mock;
      revokeRefreshTokens: jest.Mock;
    };
    identityToolkit: jest.Mock;
    secureToken: jest.Mock;
  };
  let profileRepository: {
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let waitlistRepository: {
    findByEmail: jest.Mock;
  };

  const profileVazio = {
    id: 'uid-123',
    name: null,
    phone: null,
    bio: null,
    grade: 1,
    completedAt: null,
    waitlistEntryId: null,
    createdAt: new Date('2026-08-16T12:00:00.000Z'),
    updatedAt: new Date('2026-08-16T12:00:00.000Z'),
  };

  beforeEach(async () => {
    firebase = {
      auth: {
        createUser: jest.fn(),
        getUser: jest.fn(),
        revokeRefreshTokens: jest.fn(),
      },
      identityToolkit: jest.fn(),
      secureToken: jest.fn(),
    };

    profileRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    waitlistRepository = { findByEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: FirebaseService, useValue: firebase },
        { provide: ProfileRepository, useValue: profileRepository },
        { provide: WaitlistRepository, useValue: waitlistRepository },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(() => 'http://localhost:4200'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('caso 1: cria usuario, cria perfil e dispara o e-mail de definir senha', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      const result = await service.signup({
        email: 'novo@test.com',
        emailConfirmation: 'novo@test.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(profileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'uid-123', grade: 1 }),
      );
      expect(firebase.identityToolkit).toHaveBeenCalledWith('sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email: 'novo@test.com',
        continueUrl: 'http://localhost:4200/?entrar=1',
      });
    });

    it('caso 1b: cria com senha aleatoria, nunca sem senha', async () => {
      // createUser({ email }) sozinho cria um usuario sem provedor de senha, e
      // pedir PASSWORD_RESET nesse estado e caminho nao garantido.
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: 'novo@test.com',
        emailConfirmation: 'novo@test.com',
      });

      const [args] = firebase.auth.createUser.mock.calls[0] as [
        { password?: string },
      ];
      expect(typeof args.password).toBe('string');
      expect(args.password!.length).toBeGreaterThan(20);
    });

    it('caso 1c: duas chamadas nao geram a mesma senha', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: 'a@test.com',
        emailConfirmation: 'a@test.com',
      });
      await service.signup({
        email: 'b@test.com',
        emailConfirmation: 'b@test.com',
      });

      const [first, second] = firebase.auth.createUser.mock.calls.map(
        (call) => (call as [{ password: string }])[0].password,
      );
      expect(first).not.toBe(second);
    });

    it('caso 2: e-mail ja cadastrado responde igual, sem criar perfil duplicado', async () => {
      // Responder diferente para e-mail conhecido transformaria o cadastro em
      // oraculo de enumeracao.
      firebase.auth.createUser.mockRejectedValue(
        Object.assign(new Error('exists'), {
          code: 'auth/email-already-exists',
        }),
      );
      firebase.identityToolkit.mockResolvedValue({});

      const result = await service.signup({
        email: 'existente@test.com',
        emailConfirmation: 'existente@test.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(profileRepository.create).not.toHaveBeenCalled();
      expect(firebase.identityToolkit).toHaveBeenCalled();
    });

    it('caso 2b: falha no envio do e-mail tambem nao muda a resposta', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockRejectedValue(new Error('EMAIL_NOT_FOUND'));

      await expect(
        service.signup({
          email: 'novo@test.com',
          emailConfirmation: 'novo@test.com',
        }),
      ).resolves.toEqual({ status: 'confirmation_sent' });
    });

    it('caso 2c: falha no envio vai para o log, mesmo sem mudar a resposta', async () => {
      // O silencio absoluto escondeu um UNAUTHORIZED_DOMAIN por um deploy
      // inteiro: o cadastro respondia 202 e o e-mail nunca chegava. A resposta
      // continua identica, por anti-enumeracao; o operador e que passa a ter
      // como saber. Ver fix.md, Fix 2.
      const logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockRejectedValue(
        new Error('UNAUTHORIZED_DOMAIN : Domain not allowlisted by project'),
      );

      await service.signup({
        email: 'novo@test.com',
        emailConfirmation: 'novo@test.com',
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('UNAUTHORIZED_DOMAIN'),
      );
      // O continueUrl entra na mensagem: sem ele, o log diz que falhou mas nao
      // qual dominio precisa ser autorizado.
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('localhost:4200'),
      );

      logSpy.mockRestore();
    });

    it('caso 2d: e-mail ja cadastrado nao polui o log, porque e esperado', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      firebase.auth.createUser.mockRejectedValue(
        Object.assign(new Error('exists'), {
          code: 'auth/email-already-exists',
        }),
      );
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: 'existente@test.com',
        emailConfirmation: 'existente@test.com',
      });

      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('caso 3: e-mails divergentes lancam BadRequestException', async () => {
      await expect(
        service.signup({
          email: 'a@test.com',
          emailConfirmation: 'b@test.com',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(firebase.auth.createUser).not.toHaveBeenCalled();
    });

    it('caso 4: normaliza os e-mails antes de comparar', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: '  Novo@Test.COM  ',
        emailConfirmation: 'novo@test.com',
      });

      expect(firebase.auth.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'novo@test.com' }),
      );
    });

    it('caso 5: vincula nome, telefone e inscricao quando o e-mail esta na waitlist', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({
        found: true,
        entry: {
          id: 'novo@test.com',
          name: 'Fulano',
          phone: '11999998888',
          email: 'novo@test.com',
          consent: true,
          createdAt: new Date(),
        },
      });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: 'novo@test.com',
        emailConfirmation: 'novo@test.com',
      });

      expect(profileRepository.create).toHaveBeenCalledWith({
        id: 'uid-123',
        name: 'Fulano',
        phone: '11999998888',
        bio: null,
        grade: 1,
        completedAt: null,
        // O ID da inscricao e o e-mail normalizado: e o caminho do documento em
        // waitlist_entries desde a spec 007.
        waitlistEntryId: 'novo@test.com',
      });
    });

    it('caso 6: perfil nasce vazio com waitlistEntryId nulo fora da waitlist', async () => {
      firebase.auth.createUser.mockResolvedValue({ uid: 'uid-123' });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });
      firebase.identityToolkit.mockResolvedValue({});

      await service.signup({
        email: 'novo@test.com',
        emailConfirmation: 'novo@test.com',
      });

      expect(profileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: null,
          phone: null,
          waitlistEntryId: null,
        }),
      );
    });
  });

  describe('login', () => {
    it('caso 10: credenciais validas devolvem sessao e refreshToken', async () => {
      firebase.identityToolkit.mockResolvedValue({
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: '3600',
        localId: 'uid-123',
        email: 'membro@test.com',
      });
      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: { ...profileVazio, grade: 5, completedAt: new Date() },
      });

      const result = await service.login({
        email: 'membro@test.com',
        password: 'senha-valida',
      });

      expect(result.refreshToken).toBe('refresh-token');
      expect(result.session).toEqual({
        accessToken: 'id-token',
        // expiresIn chega como string do Identity Toolkit; o contrato do front
        // e numero, e devolver string quebraria o tipo sem erro visivel.
        expiresIn: 3600,
        user: { id: 'uid-123', email: 'membro@test.com' },
        profileCompleted: true,
        grade: 5,
      });
      expect(typeof result.session.expiresIn).toBe('number');
    });

    it('caso 11: credencial errada e usuario inexistente dao a mesma resposta', async () => {
      firebase.identityToolkit.mockRejectedValue(
        new Error('INVALID_LOGIN_CREDENTIALS'),
      );

      await expect(
        service.login({ email: 'membro@test.com', password: 'errada' }),
      ).rejects.toThrow(UnauthorizedException);

      firebase.identityToolkit.mockRejectedValue(new Error('EMAIL_NOT_FOUND'));

      await expect(
        service.login({ email: 'ninguem@test.com', password: 'qualquer' }),
      ).rejects.toThrow('E-mail ou senha inválidos.');
    });

    it('caso 12: cria o perfil na hora quando o usuario nao tem', async () => {
      firebase.identityToolkit.mockResolvedValue({
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresIn: '3600',
        localId: 'uid-123',
        email: 'membro@test.com',
      });
      profileRepository.findById.mockResolvedValue({
        found: false,
        entry: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: profileVazio });

      const result = await service.login({
        email: 'membro@test.com',
        password: 'senha-valida',
      });

      expect(profileRepository.create).toHaveBeenCalled();
      expect(result.session.profileCompleted).toBe(false);
      expect(result.session.grade).toBe(1);
    });
  });

  describe('refresh', () => {
    it('caso 13: refresh valido devolve token novo e rotaciona o refresh', async () => {
      // A resposta do securetoken vem em snake_case, diferente do camelCase do
      // Identity Toolkit. Sao duas APIs do Google com convencoes diferentes, e
      // trocar uma pela outra e erro silencioso.
      firebase.secureToken.mockResolvedValue({
        id_token: 'id-token-novo',
        refresh_token: 'refresh-token-novo',
        expires_in: '3600',
        user_id: 'uid-123',
      });
      firebase.auth.getUser.mockResolvedValue({ email: 'membro@test.com' });
      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: profileVazio,
      });

      const result = await service.refresh('refresh-token-antigo');

      expect(firebase.secureToken).toHaveBeenCalledWith({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-antigo',
      });
      expect(result.refreshToken).toBe('refresh-token-novo');
      expect(result.session.accessToken).toBe('id-token-novo');
      expect(result.session.user.email).toBe('membro@test.com');
    });

    it('caso 13b: busca o e-mail no Admin SDK, porque o securetoken so devolve o uid', async () => {
      firebase.secureToken.mockResolvedValue({
        id_token: 'id-token-novo',
        refresh_token: 'refresh-token-novo',
        expires_in: '3600',
        user_id: 'uid-123',
      });
      firebase.auth.getUser.mockResolvedValue({ email: 'membro@test.com' });
      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: profileVazio,
      });

      await service.refresh('refresh-token-antigo');

      expect(firebase.auth.getUser).toHaveBeenCalledWith('uid-123');
    });

    it('caso 14: refresh invalido ou ausente lanca UnauthorizedException', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(firebase.secureToken).not.toHaveBeenCalled();

      firebase.secureToken.mockRejectedValue(new Error('TOKEN_EXPIRED'));

      await expect(service.refresh('invalido')).rejects.toThrow(
        'Sessão expirada ou inválida.',
      );
    });
  });

  describe('logout', () => {
    it('caso 15: sem cookie resolve sem erro, de forma idempotente', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(firebase.auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('caso 16: com cookie valido revoga os tokens do usuario', async () => {
      // ATENCAO: isto e global, nao por sessao. O Firebase revoga por usuario, e
      // o escopo `local` que a spec 005 escolheu de proposito nao tem
      // equivalente. Sair no laboratorio desloga o celular.
      firebase.secureToken.mockResolvedValue({
        id_token: 'x',
        refresh_token: 'y',
        expires_in: '3600',
        user_id: 'uid-123',
      });
      firebase.auth.revokeRefreshTokens.mockResolvedValue(undefined);

      await service.logout('refresh-token-valido');

      expect(firebase.auth.revokeRefreshTokens).toHaveBeenCalledWith('uid-123');
    });

    it('caso 17: cookie invalido nao revoga nada e ainda resolve', async () => {
      firebase.secureToken.mockRejectedValue(
        new Error('INVALID_REFRESH_TOKEN'),
      );

      await expect(service.logout('forjado')).resolves.toBeUndefined();
      expect(firebase.auth.revokeRefreshTokens).not.toHaveBeenCalled();
    });

    it('caso 18: falha na revogacao nao vira erro para o chamador', async () => {
      // O objetivo do logout e o estado final "deslogado". Uma falha de rede nao
      // pode prender o usuario dentro da conta.
      firebase.secureToken.mockResolvedValue({
        id_token: 'x',
        refresh_token: 'y',
        expires_in: '3600',
        user_id: 'uid-123',
      });
      firebase.auth.revokeRefreshTokens.mockRejectedValue(
        new Error('rede caiu'),
      );

      await expect(
        service.logout('refresh-token-valido'),
      ).resolves.toBeUndefined();
    });
  });
});
