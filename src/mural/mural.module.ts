import { Module } from '@nestjs/common';
import { MuralRepository } from './mural.repository';
import { MuralService } from './mural.service';
import { VoteService } from './vote.service';
import { MuralController } from './mural.controller';
import { AdminMuralController } from './admin-mural.controller';
import { ProfileModule } from '../profile/profile.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ProfileModule, NotificationsModule],
  controllers: [MuralController, AdminMuralController],
  providers: [MuralRepository, MuralService, VoteService],
  exports: [MuralRepository, MuralService],
})
export class MuralModule {}
