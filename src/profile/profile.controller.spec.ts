import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUserData } from '../auth/decorators/current-user.decorator';

describe('ProfileController', () => {
  let controller: ProfileController;
  let service: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
  };

  const mockUser: CurrentUserData = {
    id: 'user-123',
    email: 'user@email.com',
  };

  beforeEach(async () => {
    service = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        {
          provide: ProfileService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
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
    expect(service.getProfile).toHaveBeenCalledWith(
      'user-123',
      'user@email.com',
    );
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
      updateDto,
    );
  });
});
