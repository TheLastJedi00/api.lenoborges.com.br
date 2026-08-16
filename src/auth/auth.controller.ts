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
    description:
      'A senha é definida **fora desta API**, na tela hospedada pelo Firebase ' +
      'para onde o link do e-mail aponta. Não existe endpoint de definir senha: ' +
      'o oobCode nunca chega aqui. Depois de definida, o usuário volta para o ' +
      'front pelo botão de retorno e faz login normalmente.',
  })
  @ApiResponse({
    status: 202,
    description:
      'Solicitação aceita. E-mail com o link de definir senha disparado. ' +
      'Resposta idêntica para e-mail novo e já cadastrado, de propósito: ' +
      'distinguir transformaria o cadastro em oráculo de enumeração.',
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

  // Nao existe rota de definir senha, e a ausencia e proposital.
  //
  // O Firebase hospeda a propria tela de definicao de senha, e o link do e-mail
  // leva direto para la. O oobCode nunca chega nesta API: quem o consome e a
  // tela do Google, que chama o accounts:resetPassword por conta propria.
  //
  // Isso encerra o que a spec 006 tentou construir em dois ciclos -- fazer o
  // token chegar na query string de uma pagina nossa. Sem a pagina, a pergunta
  // nao se faz. Ver a decisao 3 da spec 007.

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
