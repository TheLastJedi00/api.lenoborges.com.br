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
import { CheckOobDto } from './dto/check-oob.dto';
import {
  ConfirmPasswordDto,
  OobEmailResponseDto,
} from './dto/confirm-password.dto';

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
      'A senha é definida **na nossa tela** (spec 020): o link do e-mail leva ' +
      'a <front>/acesso, e é de lá que o oobCode chega neste controller, pelo ' +
      'POST /auth/password. O e-mail continua sendo o do Firebase, editado no ' +
      'console; o que mudou foi a action URL, para onde ele aponta.',
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

  // As tres rotas abaixo sao **publicas: nenhum guard, nenhum token, nenhum
  // cookie** (decisao 7 da spec 020). Elas precisam funcionar para quem nunca
  // esteve logado naquele navegador -- e a mesma razao do /descadastro da spec
  // 014, e o defeito, se houvesse guard, so apareceria para quem esta
  // deslogado, ou seja, para todo mundo que as usa.
  //
  // O `LegalAcceptanceGuard` da spec 018 tambem **nao** alcanca aqui, e e
  // obrigatorio que nao alcance: quem esta definindo a senha ainda nao tem
  // sessao, e quem confirma a troca de e-mail pode ter `pendingLegal`. Um 428
  // nesta rota trancaria a pessoa fora da conta pela porta que ela usa para
  // entrar, e a saida seria aceitar os termos, que exige logar, que exige a
  // senha que ela esta tentando definir.
  //
  // Os limites de `Throttle` sao apertados de proposito e **nao protegem o
  // `oobCode`** -- ele tem entropia de sobra e nao se adivinha por forca bruta
  // a cinco tentativas por minuto. Eles impedem que esta API vire um alvo
  // barato de reflexao contra o Identity Toolkit, que e o que um endpoint
  // publico sem limite e.

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('password/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conferir o oobCode do link e descobrir de quem ele é',
    description:
      'Confere o código **sem consumi-lo** e devolve o e-mail dono do link, ' +
      'para a tela escrever "criando a senha de fulano@exemplo.com" acima do ' +
      'formulário. Devolver o e-mail não contraria a regra que governa o ' +
      'signup: lá o requisitante fornece o e-mail e quer saber se ele existe; ' +
      'aqui ele fornece o oobCode, que só chegou por uma caixa de entrada, e ' +
      'portanto já sabe de qual e-mail se trata.',
  })
  @ApiResponse({
    status: 200,
    description: 'Código válido. Retorna o e-mail dono do link.',
    type: OobEmailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Link morto. Expirado, inválido e não permitido dão a **mesma** ' +
      'resposta: distinguir informaria a quem colou um código qualquer se ele ' +
      'existiu algum dia. O código do Google fica no log.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async checkOobCode(@Body() dto: CheckOobDto): Promise<OobEmailResponseDto> {
    return this.authService.checkOobCode(dto.oobCode);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Definir a senha pelo oobCode do link do e-mail',
    description:
      'Aplica a senha nova e encerra. **Não devolve token e não grava ' +
      'cookie**: sessão nasce no POST /auth/login, num caminho só. O front ' +
      'manda a pessoa para /?entrar=1 e ela entra com a senha que acabou de ' +
      'criar. Concluir a redefinição também marca o e-mail como verificado, ' +
      'e isso é o próprio Firebase quem faz.',
  })
  @ApiResponse({
    status: 204,
    description: 'Senha definida. Sem corpo, sem token e sem Set-Cookie.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Link morto (mesma resposta de expirado e inválido) ou senha recusada ' +
      'pela política do projeto — que é a do console, não o mínimo do DTO.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async confirmPassword(@Body() dto: ConfirmPasswordDto): Promise<void> {
    await this.authService.confirmPassword(dto.oobCode, dto.newPassword);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('email-action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aplicar a ação de e-mail que o oobCode carrega',
    description:
      'Serve a verifyAndChangeEmail, verifyEmail e recoverEmail, e **quem ' +
      'decide qual deles é o próprio código**, não o corpo da requisição: o ' +
      'oobCode carrega o requestType, e o Firebase recusa um código de reset ' +
      'usado como código de verificação. O mode da query existe para o front ' +
      'escolher qual tela desenhar, e só para isso.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ação aplicada. Retorna o e-mail resultante.',
    type: OobEmailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Link morto, com a mesma resposta dos outros dois endpoints.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async applyEmailAction(
    @Body() dto: CheckOobDto,
  ): Promise<OobEmailResponseDto> {
    return this.authService.applyEmailAction(dto.oobCode);
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
