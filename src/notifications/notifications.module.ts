import { Module } from '@nestjs/common';
import { NotificationRepository } from './notification.repository';
import { NotificationReadRepository } from './notification-read.repository';

/**
 * O canal de notificacao interna do produto (spec 012).
 *
 * Exporta os repositorios e, na Fase 02, o service: quem dispara os avisos e o
 * `BadgeVideoService` e o `MuralService`, que vivem em outros modulos.
 */
@Module({
  providers: [NotificationRepository, NotificationReadRepository],
  exports: [NotificationRepository, NotificationReadRepository],
})
export class NotificationsModule {}
