import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationDto } from './dto/notification.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

@ApiTags('notificacoes')
@ApiBearerAuth()
@Controller('notificacoes')
@UseGuards(FirebaseAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Notificações não lidas',
    description:
      'A lista **já vem filtrada**: só não lidas, dos últimos 30 dias, no ' +
      'máximo 50, sem as do próprio autor e sem as anteriores à entrada do ' +
      'membro. O cliente não peneira nada, e não existe campo `read` para ' +
      'peneirar com.',
  })
  @ApiResponse({ status: 200, type: [NotificationDto] })
  async list(@CurrentUser() user: CurrentUserData): Promise<NotificationDto[]> {
    return this.notifications.listUnread(user.id);
  }

  /**
   * Vem antes da rota de `:id/lida` de proposito.
   *
   * O Nest casa rotas na ordem de declaracao, e `lidas` cairia dentro de `:id`
   * se esta viesse depois -- o mesmo cuidado que a reordenacao de videos ja
   * exigiu na spec 009.
   */
  @Post('lidas')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Marcar todas como lidas',
    description:
      'Marca exatamente o que aquela pessoa veria, e não tudo o que existe. ' +
      'É o que impede quem não usa o recurso de carregar um contador para sempre.',
  })
  @ApiResponse({ status: 204, description: 'Marcadas.' })
  async markAllRead(@CurrentUser() user: CurrentUserData): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }

  @Post(':id/lida')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Marcar uma como lida',
    description:
      'Idempotente: responde 204 mesmo se já estava lida. São dois chamadores ' +
      'no painel — abrir o modal da notificação e o botão de check da linha —, ' +
      'então marcar duas vezes é rotina, não erro.',
  })
  @ApiResponse({ status: 204, description: 'Marcada, ou já estava.' })
  async markRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
