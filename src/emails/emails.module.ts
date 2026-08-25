import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * O canal externo do produto (spec 014).
 *
 * Exporta o `MailerService` porque quem dispara mora fora daqui — o
 * `BadgeVideoService` publica vídeo e o admin escreve campanha. **Nenhum deles
 * conhece o provedor**: o pacote `resend` é importado só em `mailer.service.ts`.
 */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class EmailsModule {}
