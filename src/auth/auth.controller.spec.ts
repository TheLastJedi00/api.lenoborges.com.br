import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    setPassword: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };
  let cookieService: {
    setRefreshToken: jest.Mock;
    clearRefreshToken: jest.Mock;
    getRefreshToken: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      setPassword: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };

    cookieService = {
      setRefreshToken: jest.fn(),
      clearRefreshToken: jest.fn(),
      getRefreshToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: CookieService,
          useValue: cookieService,
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

  it('should perform login, set cookie and return session on POST /auth/login', async () => {
    const sessionData = {
      accessToken: 'access-jwt',
      expiresIn: 3600,
      user: { id: 'u1', email: 'u1@test.com' },
      profileCompleted: false,
      grade: 1,
    };
    authService.login.mockResolvedValue({
      session: sessionData,
      refreshToken: 'refresh-rt',
    });

    const res = {} as Response;
    const dto = { email: 'u1@test.com', password: 'pass' };
    const result = await controller.login(dto, res);

    expect(result).toEqual(sessionData);
    expect(cookieService.setRefreshToken).toHaveBeenCalledWith(
      res,
      'refresh-rt',
    );
  });

  it('should perform refresh, set new cookie on POST /auth/refresh', async () => {
    const sessionData = {
      accessToken: 'new-access-jwt',
      expiresIn: 3600,
      user: { id: 'u1', email: 'u1@test.com' },
      profileCompleted: true,
      grade: 1,
    };
    authService.refresh.mockResolvedValue({
      session: sessionData,
      refreshToken: 'new-refresh-rt',
    });
    cookieService.getRefreshToken.mockReturnValue('old-refresh-rt');

    const req = {
      cookies: { eduleno_rt: 'old-refresh-rt' },
    } as unknown as Request;
    const res = {} as Response;

    const result = await controller.refresh(req, res);

    expect(result).toEqual(sessionData);
    expect(cookieService.setRefreshToken).toHaveBeenCalledWith(
      res,
      'new-refresh-rt',
    );
  });

  it('should clear cookie on failed refresh 401 on POST /auth/refresh', async () => {
    cookieService.getRefreshToken.mockReturnValue('invalid-rt');
    authService.refresh.mockRejectedValue(
      new UnauthorizedException('Sessão expirada ou inválida.'),
    );

    const req = { cookies: { eduleno_rt: 'invalid-rt' } } as unknown as Request;
    const res = {} as Response;

    await expect(controller.refresh(req, res)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(cookieService.clearRefreshToken).toHaveBeenCalledWith(res);
  });

  it('should perform logout and clear cookie on POST /auth/logout', async () => {
    cookieService.getRefreshToken.mockReturnValue('rt-to-logout');
    authService.logout.mockResolvedValue(undefined);

    const req = {
      cookies: { eduleno_rt: 'rt-to-logout' },
    } as unknown as Request;
    const res = {} as Response;

    await controller.logout(req, res);

    expect(authService.logout).toHaveBeenCalledWith('rt-to-logout');
    expect(cookieService.clearRefreshToken).toHaveBeenCalledWith(res);
  });
});
