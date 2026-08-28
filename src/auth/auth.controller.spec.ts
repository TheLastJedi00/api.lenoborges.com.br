import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { CheckOobDto } from './dto/check-oob.dto';
import { ConfirmPasswordDto } from './dto/confirm-password.dto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    checkOobCode: jest.Mock;
    confirmPassword: jest.Mock;
    applyEmailAction: jest.Mock;
  };
  let cookieService: {
    setRefreshToken: jest.Mock;
    clearRefreshToken: jest.Mock;
    getRefreshToken: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      checkOobCode: jest.fn(),
      confirmPassword: jest.fn(),
      applyEmailAction: jest.fn(),
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
  /**
   * Spec 020: as tres rotas do oobCode.
   *
   * Os testes daqui sao quase todos de **ausencia** -- de guard, de cookie, de
   * campo aceito -- e ausencia e a coisa mais facil de desfazer por engano:
   * ninguem apaga um guard, mas qualquer um acrescenta.
   */
  describe('oobCode (spec 020)', () => {
    /** Os metadados de guard que o Nest grava no handler e na classe. */
    function guardsDe(handler: string): unknown[] {
      const doMetodo = (Reflect.getMetadata(
        '__guards__',
        (controller as unknown as Record<string, () => unknown>)[handler],
      ) ?? []) as unknown[];
      const daClasse = (Reflect.getMetadata('__guards__', AuthController) ??
        []) as unknown[];

      return [...daClasse, ...doMetodo];
    }

    it('teste-trava: as tres rotas nao tem guard nenhum', () => {
      // Decisao 8. Um FirebaseAuthGuard aqui quebraria o cadastro inteiro, e um
      // LegalAcceptanceGuard responderia 428 a quem esta tentando definir a
      // senha -- e a saida do 428 e aceitar os termos, que exige logar, que
      // exige a senha que a pessoa esta tentando definir.
      expect(guardsDe('checkOobCode')).toEqual([]);
      expect(guardsDe('confirmPassword')).toEqual([]);
      expect(guardsDe('applyEmailAction')).toEqual([]);
    });

    it('POST /auth/password/check devolve o e-mail dono do link', async () => {
      authService.checkOobCode.mockResolvedValue({ email: 'f@email.com' });

      const result = await controller.checkOobCode({ oobCode: 'codigo' });

      expect(result).toEqual({ email: 'f@email.com' });
      expect(authService.checkOobCode).toHaveBeenCalledWith('codigo');
    });

    it('teste-trava: POST /auth/password responde 204 e NAO grava cookie', async () => {
      // Decisao 10: sessao nasce no login, num caminho so. O handler nem
      // recebe a Response -- nao ha por onde um Set-Cookie sair daqui.
      authService.confirmPassword.mockResolvedValue(undefined);

      const result = await controller.confirmPassword({
        oobCode: 'codigo',
        newPassword: 'senha-nova-forte',
      });

      expect(result).toBeUndefined();
      expect(cookieService.setRefreshToken).not.toHaveBeenCalled();
      expect(
        Reflect.getMetadata(
          '__httpCode__',
          (controller as unknown as Record<string, () => unknown>)
            .confirmPassword,
        ),
      ).toBe(204);
    });

    it('POST /auth/email-action aplica a acao e devolve o e-mail', async () => {
      authService.applyEmailAction.mockResolvedValue({
        email: 'novo@email.com',
      });

      const result = await controller.applyEmailAction({ oobCode: 'codigo' });

      expect(result).toEqual({ email: 'novo@email.com' });
      expect(authService.applyEmailAction).toHaveBeenCalledWith('codigo');
    });

    it('teste-trava: um campo mode no corpo e rejeitado, nao ignorado', async () => {
      // Decisao 3: o mode chega da URL do navegador, escrito por quem manda o
      // link. Os DTOs nao o declaram, e o ValidationPipe do main.ts roda com
      // whitelist e forbidNonWhitelisted -- entao o corpo que o traga volta
      // 400, em vez de passar com o campo silenciosamente descartado.
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      await expect(
        pipe.transform(
          { oobCode: 'codigo', mode: 'verifyEmail' },
          { type: 'body', metatype: CheckOobDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          {
            oobCode: 'codigo',
            newPassword: 'senha-nova-forte',
            mode: 'resetPassword',
          },
          { type: 'body', metatype: ConfirmPasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
