import { Module } from '@nestjs/common';
import { BadgeVideoRepository } from './badge-video.repository';
import { BadgeVideoService } from './badge-video.service';
import { TrackController } from './track.controller';
import { AdminTrackController } from './admin-track.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailsModule } from '../emails/emails.module';

@Module({
  imports: [NotificationsModule, EmailsModule],
  controllers: [TrackController, AdminTrackController],
  providers: [BadgeVideoRepository, BadgeVideoService],
  exports: [BadgeVideoRepository, BadgeVideoService],
})
export class TrackModule {}
