import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { EmailPreferenceDto } from './dto/email-preference.dto';
import { CookieService } from '../auth/cookie.service';
import { ProfileDto } from './dto/profile.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
@UseGuards(FirebaseAuthGuard)
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly cookieService: CookieService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Obter dados do perfil do membro autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Perfil retornado com sucesso.',
    type: ProfileDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou expirado.',
  })
  async getProfile(@CurrentUser() user: CurrentUserData): Promise<ProfileDto> {
    // O papel vem do token que o guard acabou de verificar, e nao de uma nova
    // ida ao Firebase Auth. E o mesmo valor, uma viagem a menos.
    return this.profileService.getProfile(user.id, user.email, user.role);
  }

  /**
   * Throttle apertado, e nao os 10/min do perfil: sem ele a decisao de nao
   * revelar `EMAIL_EXISTS` vira teatro -- quem pode tentar mil vezes por minuto
   * enumera do mesmo jeito, so mais devagar.
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('email')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Pedir a troca do e-mail de acesso',
    description:
      'ATENÇÃO: este endpoint NÃO troca o e-mail. Ele reautentica com a senha ' +
      'atual e pede ao Firebase que envie a confirmação PARA O ENDEREÇO NOVO. ' +
      'Quem troca o e-mail é o Google, quando o link for clicado — o oobCode ' +
      'não passa por esta API. Até lá, o login continua sendo pelo e-mail antigo.',
  })
  @ApiResponse({
    status: 202,
    description:
      'Pedido aceito e confirmação enviada ao endereço novo. A troca ainda ' +
      'não aconteceu.',
  })
  @ApiResponse({
    status: 400,
    description:
      'E-mail inválido, igual ao atual, ou recusado. A mensagem é a mesma nos ' +
      'três casos, de propósito: distinguir revelaria quais e-mails existem.',
  })
  @ApiResponse({ status: 401, description: 'Senha incorreta.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async changeEmail(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangeEmailDto,
  ): Promise<{ status: 'confirmation_sent' }> {
    return this.profileService.changeEmail(user.id, user.email, dto);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Trocar a senha',
    description:
      'ATENÇÃO: A SESSÃO TERMINA. Trocar a senha revoga os refresh tokens de ' +
      'todos os aparelhos e limpa o cookie deste navegador — trocar a senha ' +
      'por desconfiar de invasão e seguir com o invasor logado é não ter ' +
      'trocado a senha. O ID token já emitido continua valendo por até uma ' +
      'hora (CHECK_REVOKED = false, decisão 2 da spec 007).',
  })
  @ApiResponse({
    status: 204,
    description: 'Senha trocada e sessão encerrada.',
  })
  @ApiResponse({
    status: 400,
    description: 'Nova senha recusada pela política de senha do projeto.',
  })
  @ApiResponse({ status: 401, description: 'Senha atual incorreta.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.profileService.changePassword(user.id, user.email, dto);

    // Revogar mata a sessao no servidor; limpar o cookie e o que faz este
    // navegador parar de tentar renovar com um token que nao vale mais.
    this.cookieService.clearRefreshToken(res);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Excluir a própria conta',
    description:
      'IRREVERSÍVEL E IMEDIATO, sem período de carência e sem desfazer. ' +
      'Somem: o usuário do Firebase Auth, o perfil, as leituras de notificação, ' +
      'os votos dados e a inscrição na lista de espera. As perguntas do Mural ' +
      'de autoria da pessoa NÃO somem — elas viram anônimas, porque carregam ' +
      'votos de terceiros e podem ter virado vídeo na trilha. Contas de ' +
      'administração são recusadas com 403.',
  })
  @ApiResponse({
    status: 204,
    description: 'Conta excluída e sessão encerrada.',
  })
  @ApiResponse({ status: 401, description: 'Senha incorreta.' })
  @ApiResponse({
    status: 403,
    description: 'Contas de administração não podem ser excluídas por aqui.',
  })
  @ApiResponse({ status: 404, description: 'Perfil não encontrado.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async deleteAccount(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.profileService.deleteAccount(
      user.id,
      user.email,
      user.role,
      dto,
    );

    this.cookieService.clearRefreshToken(res);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('emails')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Ligar ou desligar o recebimento de e-mails',
    description:
      'Escreve o mesmo opt-out que o link do rodapé de todo e-mail escreve. ' +
      'Vale para tudo que o produto dispara — não existe e-mail que ignore o ' +
      'descadastro. Os e-mails de conta (definir senha, verificar endereço) são ' +
      'do Firebase e não passam por aqui, e é isso que permite a regra ser absoluta.',
  })
  @ApiResponse({ status: 204, description: 'Preferência registrada.' })
  @ApiResponse({ status: 404, description: 'Perfil não encontrado.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async setEmailPreference(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: EmailPreferenceDto,
  ): Promise<void> {
    await this.profileService.setEmailPreference(user.id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('profile')
  @ApiOperation({ summary: 'Completar onboarding ou atualizar perfil' })
  @ApiResponse({
    status: 200,
    description:
      'Perfil atualizado com sucesso. completed_at é preenchido na primeira vez.',
    type: ProfileDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Erro de validação nos campos (nome, telefone ou bio).',
  })
  @ApiResponse({
    status: 401,
    description: 'Token ausente, inválido ou expirado.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profileService.updateProfile(
      user.id,
      user.email,
      user.role,
      dto,
    );
  }
}
