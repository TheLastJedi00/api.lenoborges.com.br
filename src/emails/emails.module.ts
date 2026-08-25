import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { EmailsController } from './emails.controller';
import { AdminEmailsController } from './admin-emails.controller';
import { AudienceService } from './audience.service';
import { ProfileModule } from '../profile/profile.module';

/**
 * O canal externo do produto (spec 014).
 *
 * Exporta o `MailerService` porque quem dispara mora fora daqui — o
 * `BadgeVideoService` publica vídeo e o admin escreve campanha. **Nenhum deles
 * conhece o provedor**: o pacote `resend` é importado só em `mailer.service.ts`.
 */
@Module({
  imports: [ProfileModule],
  controllers: [EmailsController, AdminEmailsController],
  providers: [MailerService, AudienceService],
  exports: [MailerService, AudienceService],
})
export class EmailsModule {}
