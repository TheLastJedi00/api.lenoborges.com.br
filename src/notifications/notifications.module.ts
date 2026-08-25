import { Module } from '@nestjs/common';
import { NotificationRepository } from './notification.repository';
import { NotificationReadRepository } from './notification-read.repository';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ProfileModule } from '../profile/profile.module';

/**
 * O canal de notificacao interna do produto (spec 012).
 *
 * Exporta o `NotificationsService` porque quem dispara os avisos mora fora daqui:
 * o `BadgeVideoService` publica video e o `MuralService` cria pergunta. Os dois
 * chamam este service e **nenhum deles pode falhar por causa dele**.
 */
@Module({
  imports: [ProfileModule],
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    NotificationReadRepository,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
