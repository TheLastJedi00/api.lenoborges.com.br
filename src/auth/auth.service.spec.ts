import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { WaitlistRepository } from '../waitlist/waitlist.repository';

describe('AuthService', () => {
  let service: AuthService;
  let supabaseService: {
    adminClient: {
      auth: {
        admin: {
          createUser: jest.Mock;
          getUserById: jest.Mock;
          updateUserById: jest.Mock;
        };
        resetPasswordForEmail: jest.Mock;
      };
    };
    createUserClient: jest.Mock;
  };
  // Cliente por requisicao: o service pede um novo a cada operacao de usuario.
  // O mock devolve sempre o mesmo objeto para as assercoes, mas conta as chamadas
  // da fabrica, que e o que prova o isolamento entre requisicoes.
  let userClient: {
    auth: {
      resetPasswordForEmail: jest.Mock;
      verifyOtp: jest.Mock;
      updateUser: jest.Mock;
      signInWithPassword: jest.Mock;
      refreshSession: jest.Mock;
      signOut: jest.Mock;
    };
  };
  let profileRepository: {
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let waitlistRepository: {
    findByEmail: jest.Mock;
  };

  beforeEach(async () => {
    supabaseService = {
      adminClient: {
        auth: {
          admin: {
            createUser: jest.fn(),
            getUserById: jest.fn(),
            updateUserById: jest.fn(),
          },
          resetPasswordForEmail: jest.fn(),
        },
      },
      createUserClient: jest.fn(() => userClient),
    };

    userClient = {
      auth: {
        resetPasswordForEmail: jest.fn(),
        verifyOtp: jest.fn(),
        updateUser: jest.fn(),
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
        signOut: jest.fn(),
      },
    };

    profileRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    waitlistRepository = {
      findByEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: supabaseService,
        },
        {
          provide: ProfileRepository,
          useValue: profileRepository,
        },
        {
          provide: WaitlistRepository,
          useValue: waitlistRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('signup', () => {
    it('caso 1: deve cadastrar novo usuario, criar perfil e disparar recovery retornando confirmation_sent', async () => {
      supabaseService.adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'user-uuid-123', email: 'novo@email.com' } },
        error: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({
        found: false,
        entry: null,
      });
      profileRepository.create.mockResolvedValue({
        entry: { id: 'user-uuid-123', grade: 1 },
      });
      supabaseService.adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await service.signup({
        email: 'novo@email.com',
        emailConfirmation: 'novo@email.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(
        supabaseService.adminClient.auth.admin.createUser,
      ).toHaveBeenCalledWith({
        email: 'novo@email.com',
        email_confirm: false,
      });
      expect(profileRepository.create).toHaveBeenCalledWith({
        id: 'user-uuid-123',
        name: null,
        phone: null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: null,
      });
      expect(
        supabaseService.adminClient.auth.resetPasswordForEmail,
      ).toHaveBeenCalledWith('novo@email.com');
    });

    it('caso 2: deve retornar a mesma resposta para email ja existente disparando recovery sem criar perfil duplicado', async () => {
      supabaseService.adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered', status: 422 },
      });
      supabaseService.adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await service.signup({
        email: 'existente@email.com',
        emailConfirmation: 'existente@email.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(profileRepository.create).not.toHaveBeenCalled();
      expect(
        supabaseService.adminClient.auth.resetPasswordForEmail,
      ).toHaveBeenCalledWith('existente@email.com');
    });

    it('caso 3: deve lancar BadRequestException se a confirmacao de email for divergente', async () => {
      await expect(
        service.signup({
          email: 'fulano@email.com',
          emailConfirmation: 'ciclano@email.com',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(
        supabaseService.adminClient.auth.admin.createUser,
      ).not.toHaveBeenCalled();
      expect(profileRepository.create).not.toHaveBeenCalled();
    });

    it('caso 4: deve normalizar os emails antes de comparar', async () => {
      supabaseService.adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'uuid-abc', email: 'fulano@email.com' } },
        error: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: { id: 'uuid-abc' } });
      supabaseService.adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await service.signup({
        email: '  Fulano@Email.COM  ',
        emailConfirmation: 'fulano@email.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(
        supabaseService.adminClient.auth.admin.createUser,
      ).toHaveBeenCalledWith({
        email: 'fulano@email.com',
        email_confirm: false,
      });
    });

    it('caso 5: deve vincular dados da waitlist no perfil se o email existir na lista de espera', async () => {
      supabaseService.adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'user-waitlist-id', email: 'membro@email.com' } },
        error: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({
        found: true,
        entry: {
          id: 'waitlist-entry-uuid',
          name: 'Membro Antigo',
          phone: '11988887777',
        },
      });
      profileRepository.create.mockResolvedValue({
        entry: { id: 'user-waitlist-id' },
      });
      supabaseService.adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      const result = await service.signup({
        email: 'membro@email.com',
        emailConfirmation: 'membro@email.com',
      });

      expect(result).toEqual({ status: 'confirmation_sent' });
      expect(profileRepository.create).toHaveBeenCalledWith({
        id: 'user-waitlist-id',
        name: 'Membro Antigo',
        phone: '11988887777',
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: 'waitlist-entry-uuid',
      });
    });

    it('caso 6: perfil nasce vazio com waitlist_entry_id nulo se email nao estiver na waitlist', async () => {
      supabaseService.adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: { id: 'novo-id', email: 'novo@email.com' } },
        error: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({ found: false });
      profileRepository.create.mockResolvedValue({ entry: { id: 'novo-id' } });
      supabaseService.adminClient.auth.resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: null,
      });

      await service.signup({
        email: 'novo@email.com',
        emailConfirmation: 'novo@email.com',
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

  describe('setPassword', () => {
    it('caso 7: deve verificar o token e atualizar a senha com sucesso sem devolver sessao', async () => {
      userClient.auth.verifyOtp.mockResolvedValue({
        data: {
          user: { id: 'user-uuid-123', email: 'user@email.com' },
          session: { access_token: 'valid-token' },
        },
        error: null,
      });
      supabaseService.adminClient.auth.admin.updateUserById.mockResolvedValue({
        data: { user: { id: 'user-uuid-123' } },
        error: null,
      });

      await expect(
        service.setPassword({
          tokenHash: 'valid-hash-token',
          password: 'nova-senha-segura',
          passwordConfirmation: 'nova-senha-segura',
        }),
      ).resolves.toBeUndefined();

      expect(userClient.auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'valid-hash-token',
        type: 'recovery',
      });
    });

    it('caso 8: deve lancar BadRequestException com mensagem generica se token for invalido ou expirado', async () => {
      userClient.auth.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Token has expired or is invalid', status: 400 },
      });

      await expect(
        service.setPassword({
          tokenHash: 'invalid-hash-token',
          password: 'nova-senha-segura',
          passwordConfirmation: 'nova-senha-segura',
        }),
      ).rejects.toThrow(
        new BadRequestException('Link inválido ou expirado, peça um novo.'),
      );
    });

    it('caso 9: deve lancar BadRequestException se senhas forem divergentes sem tocar no Supabase', async () => {
      await expect(
        service.setPassword({
          tokenHash: 'valid-hash-token',
          password: 'senha-digitada-1',
          passwordConfirmation: 'senha-digitada-2',
        }),
      ).rejects.toThrow(new BadRequestException('Senhas não conferem.'));

      expect(userClient.auth.verifyOtp).not.toHaveBeenCalled();
      expect(
        supabaseService.adminClient.auth.admin.updateUserById,
      ).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('caso 10: deve fazer login com credenciais validas e devolver session e refreshToken', async () => {
      userClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: {
            access_token: 'access-jwt',
            expires_in: 3600,
            refresh_token: 'refresh-rt',
          },
          user: {
            id: 'user-id-123',
            email: 'aluno@email.com',
          },
        },
        error: null,
      });

      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-id-123',
          grade: 2,
          completedAt: new Date('2026-08-14T10:00:00.000Z'),
        },
      });

      const result = await service.login({
        email: '  Aluno@Email.com  ',
        password: 'password123',
      });

      expect(result).toEqual({
        session: {
          accessToken: 'access-jwt',
          expiresIn: 3600,
          user: {
            id: 'user-id-123',
            email: 'aluno@email.com',
          },
          profileCompleted: true,
          grade: 2,
        },
        refreshToken: 'refresh-rt',
      });
      expect(userClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'aluno@email.com',
        password: 'password123',
      });
    });

    it('caso 11: deve lancar UnauthorizedException com a mesma mensagem para credencial errada ou usuario inexistente', async () => {
      userClient.auth.signInWithPassword.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid login credentials', status: 400 },
      });

      await expect(
        service.login({
          email: 'errado@email.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('E-mail ou senha inválidos.');
    });

    it('caso 12: deve criar o perfil na hora caso o usuario nao possua perfil ao logar', async () => {
      userClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: {
            access_token: 'access-jwt-2',
            expires_in: 3600,
            refresh_token: 'refresh-rt-2',
          },
          user: {
            id: 'user-sem-perfil',
            email: 'novo@email.com',
          },
        },
        error: null,
      });

      profileRepository.findById.mockResolvedValue({
        found: false,
        entry: null,
      });
      waitlistRepository.findByEmail.mockResolvedValue({
        found: false,
        entry: null,
      });
      profileRepository.create.mockResolvedValue({
        entry: {
          id: 'user-sem-perfil',
          grade: 1,
          completedAt: null,
        },
      });

      const result = await service.login({
        email: 'novo@email.com',
        password: 'password123',
      });

      expect(result.session.profileCompleted).toBe(false);
      expect(result.session.grade).toBe(1);
      expect(profileRepository.create).toHaveBeenCalledWith({
        id: 'user-sem-perfil',
        name: null,
        phone: null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: null,
      });
    });
  });

  describe('refresh', () => {
    it('caso 13: refresh valido devolve access novo e refresh rotacionado', async () => {
      userClient.auth.refreshSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'new-access-jwt',
            expires_in: 3600,
            refresh_token: 'new-refresh-rt',
          },
          user: {
            id: 'user-id-123',
            email: 'aluno@email.com',
          },
        },
        error: null,
      });

      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: {
          id: 'user-id-123',
          grade: 1,
          completedAt: null,
        },
      });

      const result = await service.refresh('old-refresh-rt');

      expect(result).toEqual({
        session: {
          accessToken: 'new-access-jwt',
          expiresIn: 3600,
          user: {
            id: 'user-id-123',
            email: 'aluno@email.com',
          },
          profileCompleted: false,
          grade: 1,
        },
        refreshToken: 'new-refresh-rt',
      });
      expect(userClient.auth.refreshSession).toHaveBeenCalledWith({
        refresh_token: 'old-refresh-rt',
      });
    });

    it('caso 14: refresh invalido ou ausente lanca UnauthorizedException', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        'Sessão expirada ou inválida.',
      );

      userClient.auth.refreshSession.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid refresh token', status: 401 },
      });

      await expect(service.refresh('token-invalido')).rejects.toThrow(
        'Sessão expirada ou inválida.',
      );
    });
  });

  describe('logout', () => {
    it('caso 15: logout sem cookie resolve sem erro de forma idempotente', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(supabaseService.createUserClient).not.toHaveBeenCalled();
      expect(userClient.auth.signOut).not.toHaveBeenCalled();
    });

    it('caso 16: logout com cookie valido revoga a sessao daquele refresh token', async () => {
      userClient.auth.refreshSession.mockResolvedValue({
        data: {
          session: { access_token: 'access-da-vitima' },
          user: { id: 'user-uuid-123' },
        },
        error: null,
      });
      userClient.auth.signOut.mockResolvedValue({ error: null });

      await expect(service.logout('refresh-valido')).resolves.toBeUndefined();

      // A sessao precisa ser carregada no cliente a partir do token do chamador
      // antes do signOut, senao o signOut derruba a sessao de outra pessoa.
      expect(userClient.auth.refreshSession).toHaveBeenCalledWith({
        refresh_token: 'refresh-valido',
      });
      expect(userClient.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('caso 17: cookie invalido nao revoga sessao nenhuma e ainda resolve', async () => {
      // Regressao do achado A1 do review: antes, qualquer cookie sem valor real
      // derrubava a sessao de quem tivesse logado por ultimo no processo.
      userClient.auth.refreshSession.mockResolvedValue({
        data: { session: null, user: null },
        error: { message: 'Invalid refresh token', status: 401 },
      });

      await expect(service.logout('cookie-forjado')).resolves.toBeUndefined();

      expect(userClient.auth.signOut).not.toHaveBeenCalled();
    });

    it('caso 18: falha do Supabase no logout nao vira erro para o chamador', async () => {
      userClient.auth.refreshSession.mockRejectedValue(new Error('rede caiu'));

      await expect(service.logout('refresh-valido')).resolves.toBeUndefined();
    });
  });

  describe('isolamento entre requisicoes', () => {
    it('caso 19: cada operacao de usuario pede um cliente novo, nunca um compartilhado', async () => {
      // O cliente do supabase-js guarda a sessao em memoria mesmo com
      // persistSession: false, entao reaproveitar uma instancia entre
      // requisicoes mistura a sessao de usuarios diferentes.
      userClient.auth.signInWithPassword.mockResolvedValue({
        data: {
          session: {
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 3600,
          },
          user: { id: 'user-1', email: 'um@email.com' },
        },
        error: null,
      });
      profileRepository.findById.mockResolvedValue({
        found: true,
        entry: { id: 'user-1', grade: 1, completedAt: null },
      });

      await service.login({ email: 'um@email.com', password: 'senha-1234' });
      await service.login({ email: 'um@email.com', password: 'senha-1234' });

      expect(supabaseService.createUserClient).toHaveBeenCalledTimes(2);
    });
  });
});
