import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { LoginDto } from './dto/login.dto';
import { SessionResponseDto } from './dto/session.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Cadastrar novo membro (dispara e-mail de definição de senha)',
  })
  @ApiResponse({
    status: 202,
    description:
      'Solicitação aceita. E-mail de confirmação/redefinição disparado.',
    type: SignupResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação ou e-mails divergentes.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async signup(@Body() dto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Definir senha e confirmar e-mail com token' })
  @ApiResponse({
    status: 204,
    description: 'Senha definida com sucesso. E-mail confirmado.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Token inválido/expirado, senhas divergentes ou erro de validação.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async setPassword(@Body() dto: SetPasswordDto): Promise<void> {
    await this.authService.setPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autenticar com e-mail e senha' })
  @ApiResponse({
    status: 200,
    description:
      'Login bem-sucedido. Retorna sessão em memória e grava cookie HttpOnly.',
    type: SessionResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'E-mail ou senha inválidos.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const { session, refreshToken } = await this.authService.login(dto);
    this.cookieService.setRefreshToken(res, refreshToken);
    return session;
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar sessão a partir do cookie HttpOnly' })
  @ApiResponse({
    status: 200,
    description:
      'Sessão renovada com sucesso. Retorna nova sessão e rotaciona o cookie.',
    type: SessionResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Cookie ausente, inválido ou expirado.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponseDto> {
    const rawToken = this.cookieService.getRefreshToken(req.cookies);
    try {
      const { session, refreshToken } =
        await this.authService.refresh(rawToken);
      this.cookieService.setRefreshToken(res, refreshToken);
      return session;
    } catch (error) {
      this.cookieService.clearRefreshToken(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerrar sessão e invalidar cookie HttpOnly' })
  @ApiResponse({
    status: 204,
    description: 'Logout realizado com sucesso (idempotente).',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawToken = this.cookieService.getRefreshToken(req.cookies);
    await this.authService.logout(rawToken);
    this.cookieService.clearRefreshToken(res);
  }
}
