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
        };
        resetPasswordForEmail: jest.Mock;
      };
    };
    publicClient: {
      auth: {
        resetPasswordForEmail: jest.Mock;
        verifyOtp: jest.Mock;
        updateUser: jest.Mock;
        signInWithPassword: jest.Mock;
        refreshSession: jest.Mock;
        signOut: jest.Mock;
      };
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
      publicClient: {
        auth: {
          resetPasswordForEmail: jest.fn(),
          verifyOtp: jest.fn(),
          updateUser: jest.fn(),
          signInWithPassword: jest.fn(),
          refreshSession: jest.fn(),
          signOut: jest.fn(),
        },
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
      waitlistRepository.findByEmail.mockResolvedValue({ found: false, entry: null });
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
      expect(supabaseService.adminClient.auth.admin.createUser).toHaveBeenCalledWith({
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
      expect(supabaseService.adminClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'novo@email.com',
      );
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
      expect(supabaseService.adminClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'existente@email.com',
      );
    });

    it('caso 3: deve lancar BadRequestException se a confirmacao de email for divergente', async () => {
      await expect(
        service.signup({
          email: 'fulano@email.com',
          emailConfirmation: 'ciclano@email.com',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(supabaseService.adminClient.auth.admin.createUser).not.toHaveBeenCalled();
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
      expect(supabaseService.adminClient.auth.admin.createUser).toHaveBeenCalledWith({
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
      supabaseService.publicClient.auth.verifyOtp.mockResolvedValue({
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

      expect(supabaseService.publicClient.auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'valid-hash-token',
        type: 'recovery',
      });
    });

    it('caso 8: deve lancar BadRequestException com mensagem generica se token for invalido ou expirado', async () => {
      supabaseService.publicClient.auth.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Token has expired or is invalid', status: 400 },
      });

      await expect(
        service.setPassword({
          tokenHash: 'invalid-hash-token',
          password: 'nova-senha-segura',
          passwordConfirmation: 'nova-senha-segura',
        }),
      ).rejects.toThrow(new BadRequestException('Link inválido ou expirado, peça um novo.'));
    });

    it('caso 9: deve lancar BadRequestException se senhas forem divergentes sem tocar no Supabase', async () => {
      await expect(
        service.setPassword({
          tokenHash: 'valid-hash-token',
          password: 'senha-digitada-1',
          passwordConfirmation: 'senha-digitada-2',
        }),
      ).rejects.toThrow(new BadRequestException('Senhas não conferem.'));

      expect(supabaseService.publicClient.auth.verifyOtp).not.toHaveBeenCalled();
      expect(supabaseService.adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    });
  });
});
