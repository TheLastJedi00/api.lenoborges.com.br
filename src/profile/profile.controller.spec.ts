import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { CookieService } from '../auth/cookie.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { LegalService } from '../legal/legal.service';
import { WatchedVideoService } from '../track/watched-video.service';

describe('ProfileController', () => {
  let controller: ProfileController;
  let service: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    changeEmail: jest.Mock;
    changePassword: jest.Mock;
    setEmailPreference: jest.Mock;
  };
  let cookieService: { clearRefreshToken: jest.Mock };
  let legalService: { accept: jest.Mock };

  const mockUser: CurrentUserData = {
    id: 'user-123',
    email: 'user@email.com',
    role: null,
  };

  beforeEach(async () => {
    service = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changeEmail: jest.fn(),
      changePassword: jest.fn(),
      setEmailPreference: jest.fn(),
    };

    cookieService = { clearRefreshToken: jest.fn() };
    legalService = { accept: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        {
          provide: ProfileService,
          useValue: service,
        },
        { provide: CookieService, useValue: cookieService },
        { provide: LegalService, useValue: legalService },
        {
          provide: WatchedVideoService,
          useValue: { setWatched: jest.fn() },
        },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProfileController>(ProfileController);
  });

  it('should call profileService.getProfile on GET /me', async () => {
    const mockProfile = {
      id: 'user-123',
      email: 'user@email.com',
      name: 'Fulano',
      phone: '11999998888',
      bio: 'Bio de teste.',
      grade: 1,
      profileCompleted: true,
    };
    service.getProfile.mockResolvedValue(mockProfile);

    const result = await controller.getProfile(mockUser);

    expect(result).toEqual(mockProfile);
    // O papel sai do token que o guard verificou, e o controller so repassa.
    expect(service.getProfile).toHaveBeenCalledWith(
      'user-123',
      'user@email.com',
      null,
    );
  });

  it('POST /me/password limpa o cookie deste navegador depois de trocar', async () => {
    // Revogar mata a sessao no servidor; limpar o cookie e o que faz este
    // navegador parar de tentar renovar com um token que nao vale mais.
    const res = {} as never;
    service.changePassword.mockResolvedValue(undefined);

    await controller.changePassword(
      mockUser,
      { currentPassword: 'atual', newPassword: 'nova-senha-forte' },
      res,
    );

    expect(service.changePassword).toHaveBeenCalledWith(
      'user-123',
      'user@email.com',
      { currentPassword: 'atual', newPassword: 'nova-senha-forte' },
    );
    expect(cookieService.clearRefreshToken).toHaveBeenCalledWith(res);
  });

  it('PATCH /me/emails repassa a preferencia para o service', async () => {
    service.setEmailPreference.mockResolvedValue(undefined);

    await controller.setEmailPreference(mockUser, { receber: false });

    expect(service.setEmailPreference).toHaveBeenCalledWith('user-123', {
      receber: false,
    });
  });

  it('should call profileService.updateProfile on PATCH /me/profile', async () => {
    const updateDto = {
      name: 'Novo Nome',
      phone: '11988887777',
      bio: 'Nova bio atualizada.',
    };
    const mockProfile = {
      id: 'user-123',
      email: 'user@email.com',
      name: 'Novo Nome',
      phone: '11988887777',
      bio: 'Nova bio atualizada.',
      grade: 1,
      profileCompleted: true,
    };
    service.updateProfile.mockResolvedValue(mockProfile);

    const result = await controller.updateProfile(mockUser, updateDto);

    expect(result).toEqual(mockProfile);
    expect(service.updateProfile).toHaveBeenCalledWith(
      'user-123',
      'user@email.com',
      null,
      updateDto,
    );
  });
});
