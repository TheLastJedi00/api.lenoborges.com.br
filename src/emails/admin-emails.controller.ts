import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { AudienceService } from './audience.service';
import { EmailCampaignService } from './email-campaign.service';
import { AudienceFilterDto } from './dto/audience-filter.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CampaignResultDto, CampaignSummaryDto } from './dto/campaign.dto';

/** Só a contagem. Ver o comentário do endpoint. */
export class AudienceCountDto {
  count: number;
}

@ApiTags('emails')
@ApiBearerAuth()
@Controller('admin/emails')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminEmailsController {
  constructor(
    private readonly audience: AudienceService,
    private readonly campaigns: EmailCampaignService,
  ) {}

  /**
   * Prévia da audiência, antes do disparo (spec 014, decisão 14).
   *
   * Existe porque **disparo de e-mail é a operação mais irreversível do
   * produto**: excluir vídeo se republica, moderar pergunta se refaz, `grade`
   * errado se corrige. E-mail que saiu, saiu — não há edição, não há apagar, e o
   * erro fica na caixa de entrada de todo mundo, com o nome do produto em cima.
   *
   * **Devolve a contagem e nunca a lista de e-mails.** O admin precisa saber
   * *quantos*, e a tela já lista os membros em `/dashboard/admin/usuarios`. Uma
   * rota que despeja a base de e-mails a cada mudança de filtro é um vazamento
   * esperando um bug de autorização.
   */
  @Post('audiencia')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Contar a audiência de um conjunto de filtros',
    description:
      'Devolve SÓ o número. Nunca a lista de e-mails: uma rota que despeja a ' +
      'base a cada mudança de filtro é um vazamento esperando um bug de ' +
      'autorização, e a tela de usuários já lista quem existe.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contagem da audiência.',
    type: AudienceCountDto,
  })
  @ApiResponse({ status: 403, description: 'Rota restrita a administradores.' })
  async countAudience(
    @Body() dto: AudienceFilterDto,
  ): Promise<AudienceCountDto> {
    const count = await this.audience.count({
      tiers: dto.tiers ?? null,
      gradeMin: dto.gradeMin ?? null,
      gradeMax: dto.gradeMax ?? null,
    });

    return { count };
  }

  /**
   * Envia o e-mail montado **para o próprio admin**, sem criar campanha.
   *
   * Nada é gravado e ninguém mais é tocado: é o ensaio antes de uma operação que
   * não tem desfazer.
   */
  @Post('teste')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Enviar o e-mail de teste para si mesmo',
    description:
      'Monta o e-mail exatamente como ele sairia e manda para o e-mail do ' +
      'próprio admin. NÃO cria campanha e não toca em mais ninguém.',
  })
  @ApiResponse({ status: 204, description: 'Teste enviado.' })
  async sendTest(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCampaignDto,
  ): Promise<void> {
    await this.campaigns.sendTest(user.email, user.id, {
      subject: dto.subject,
      body: dto.body,
      ctaLabel: dto.ctaLabel ?? null,
      ctaUrl: dto.ctaUrl ?? null,
    });
  }

  /**
   * Cria a campanha e dispara.
   *
   * **O envio acontece dentro desta requisição**, e a resposta é o resultado —
   * não um aceite. Com lote de 100 e o limite do provedor, mil membros são cerca
   * de cinco segundos; dez mil são quase um minuto, que é onde a função
   * serverless morre. Está dimensionado para a comunidade de hoje, e o sinal de
   * que passou do ponto é campanha terminando `interrompida` com frequência —
   * quando isso acontecer, a saída é fila, e é outra spec.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Criar a campanha e disparar',
    description:
      'O ENVIO ACONTECE DENTRO DESTA REQUISIÇÃO, e a resposta é o resultado, ' +
      'não um aceite. Responde 409 se já houver outro disparo em andamento, e ' +
      '400 se os filtros não pegarem ninguém — campanha para zero pessoa é ' +
      'sempre engano.',
  })
  @ApiResponse({
    status: 201,
    description: 'Disparo executado.',
    type: CampaignResultDto,
  })
  @ApiResponse({ status: 400, description: 'Os filtros não pegam ninguém.' })
  @ApiResponse({
    status: 409,
    description: 'Já existe um disparo em andamento.',
  })
  async createCampaign(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCampaignDto,
  ): Promise<CampaignResultDto> {
    return this.campaigns.createAndSend({
      kind: 'manual',
      subject: dto.subject,
      body: dto.body,
      ctaLabel: dto.ctaLabel ?? null,
      ctaUrl: dto.ctaUrl ?? null,
      filters: {
        tiers: dto.tiers ?? null,
        gradeMin: dto.gradeMin ?? null,
        gradeMax: dto.gradeMax ?? null,
      },
      createdBy: user.id,
    });
  }

  @Post(':id/retomar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retomar uma campanha interrompida',
    description:
      'Continua a partir do cursor, e não do começo. Campanha concluída ' +
      'responde 409: retomar algo que terminou seria reenviar.',
  })
  @ApiResponse({
    status: 200,
    description: 'Disparo retomado.',
    type: CampaignResultDto,
  })
  @ApiResponse({ status: 404, description: 'Campanha não encontrada.' })
  @ApiResponse({
    status: 409,
    description: 'A campanha não está interrompida.',
  })
  async resumeCampaign(@Param('id') id: string): Promise<CampaignResultDto> {
    return this.campaigns.resume(id);
  }

  @Get()
  @ApiOperation({
    summary: 'As campanhas mais recentes',
    description:
      'As 20 mais recentes, para o histórico da tela. NÃO devolve o corpo do ' +
      'e-mail: a lista existe para responder "o que saiu e para quantos".',
  })
  @ApiResponse({ status: 200, type: [CampaignSummaryDto] })
  async listCampaigns(): Promise<CampaignSummaryDto[]> {
    const campanhas = await this.campaigns.listRecent();

    return campanhas.map((campanha) => ({
      id: campanha.id,
      kind: campanha.kind,
      subject: campanha.subject,
      status: campanha.status,
      audienceCount: campanha.audienceCount,
      sentCount: campanha.sentCount,
      failedCount: campanha.failedCount,
      createdAt: campanha.createdAt.toISOString(),
      finishedAt: campanha.finishedAt
        ? campanha.finishedAt.toISOString()
        : null,
      error: campanha.error,
    }));
  }
}
