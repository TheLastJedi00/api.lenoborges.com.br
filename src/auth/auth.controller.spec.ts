import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    setPassword: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      setPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should call authService.signup on POST /auth/signup', async () => {
    authService.signup.mockResolvedValue({ status: 'confirmation_sent' });

    const dto = {
      email: 'test@email.com',
      emailConfirmation: 'test@email.com',
    };
    const result = await controller.signup(dto);

    expect(result).toEqual({ status: 'confirmation_sent' });
    expect(authService.signup).toHaveBeenCalledWith(dto);
  });

  it('should call authService.setPassword on POST /auth/password', async () => {
    authService.setPassword.mockResolvedValue(undefined);

    const dto = {
      tokenHash: 'token-123',
      password: 'password123',
      passwordConfirmation: 'password123',
    };
    await controller.setPassword(dto);

    expect(authService.setPassword).toHaveBeenCalledWith(dto);
  });
});
