import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { PrivacyPreferenceDto } from './dto/privacy-preference.dto';
import { WatchedVideoService } from '../track/watched-video.service';
import { SetWatchedDto, WatchedVideoDto } from '../track/dto/set-watched.dto';
import { CookieService } from '../auth/cookie.service';
import { ProfileDto } from './dto/profile.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { LegalService } from '../legal/legal.service';
import { AcceptLegalDto } from '../legal/dto/accept-legal.dto';
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
    private readonly legalService: LegalService,
    private readonly watchedVideoService: WatchedVideoService,
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

  /**
   * Registra o aceite de **um** documento legal (spec 018, decisao 5).
   *
   * Mora aqui, e nao no `LegalController`, porque o prefixo `/me` e deste
   * controller e porque so faz sentido autenticado -- ler e publico, aceitar
   * nao. E uma das rotas isentas do `LegalAcceptanceGuard`: sem isso ela seria
   * bloqueada pela propria condicao que existe para resolver, e ninguem entraria
   * no produto nunca mais.
   *
   * Throttle de 10/min: sao dois aceites por pessoa na vida normal, e o limite
   * existe so contra script.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('legal-acceptances')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Registrar o aceite de um documento legal',
    description:
      'Um documento por chamada, com a versão exibida ao usuário no corpo. ' +
      'Aceitar de novo a mesma versão é 204 e NÃO reescreve a data original. ' +
      'Versão diferente da vigente é 409 com a atual no corpo — significa aba ' +
      'aberta desde antes do deploy, e o aceite dela é de um texto que não é ' +
      'mais o texto.',
  })
  @ApiResponse({ status: 204, description: 'Aceite registrado.' })
  @ApiResponse({ status: 404, description: 'Documento não encontrado.' })
  @ApiResponse({
    status: 409,
    description: 'O documento foi atualizado. A versão vigente vai no corpo.',
  })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async acceptLegal(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: AcceptLegalDto,
  ): Promise<void> {
    await this.legalService.accept(user.id, dto);
  }

  /**
   * Marcar ou desmarcar um vídeo assistido (spec 019).
   *
   * Mora aqui porque o prefixo `/me` é deste controller — o serviço é o do
   * `TrackModule`, do mesmo jeito que o aceite legal mora aqui com o serviço do
   * `LegalModule`.
   *
   * Throttle de 60/min: marcar seis vídeos seguidos ao terminar uma insígnia é
   * uso normal, e o limite existe contra script.
   */
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Put('watched-videos/:videoId')
  @ApiOperation({
    summary: 'Marcar ou desmarcar um vídeo como assistido',
    description:
      '**Idempotente.** Marcar o que já está marcado responde 200 sem pagar XP ' +
      'de novo, e desmarcar **não devolve** o XP já pago — o registro do vídeo ' +
      'não é apagado nunca, e é isso que impede o farm por duplo clique.\n\n' +
      'A resposta traz o `xp` já atualizado, para a tela não somar nada: ' +
      'remarcar um vídeo não paga XP, e uma soma no cliente acertaria no ' +
      'primeiro clique de cada vídeo e erraria em todos os seguintes.',
  })
  @ApiResponse({ status: 200, type: WatchedVideoDto })
  @ApiResponse({ status: 404, description: 'Vídeo não encontrado.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async setWatched(
    @CurrentUser() user: CurrentUserData,
    @Param('videoId') videoId: string,
    @Body() dto: SetWatchedDto,
  ): Promise<WatchedVideoDto> {
    return this.watchedVideoService.setWatched(user.id, videoId, dto);
  }

  /**
   * O interruptor das redes sociais (spec 019, decisão 9).
   *
   * Rota própria, e **não um campo a mais em `PATCH /me/profile`**: aquele exige
   * nome, telefone e bio, e é ele que carimba `completedAt` — um interruptor que
   * exige reenviar o cadastro inteiro é um interruptor que ninguém liga. Mesmo
   * desenho do `PATCH /me/emails` logo abaixo, pela mesma razão.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Patch('privacy')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mostrar ou esconder as redes sociais dos outros membros',
    description:
      'Decide se `linkedin` e `instagram` aparecem no cartão que os outros ' +
      'membros abrem (`GET /members/:uid`). **Nasce desligado.**\n\n' +
      '**Não esconde nada da administração**: `GET /admin/users/:uid` continua ' +
      'trazendo os dois links, porque a operação já lê telefone e e-mail de ' +
      'todo mundo — um campo escondido dela seria teatro de privacidade.',
  })
  @ApiResponse({ status: 204, description: 'Preferência registrada.' })
  @ApiResponse({ status: 404, description: 'Perfil não encontrado.' })
  @ApiResponse({ status: 429, description: 'Limite de requisições excedido.' })
  async setPrivacyPreference(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PrivacyPreferenceDto,
  ): Promise<void> {
    await this.profileService.setPrivacyPreference(user.id, dto);
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
