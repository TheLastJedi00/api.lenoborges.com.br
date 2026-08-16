import { Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { WaitlistModule } from '../waitlist/waitlist.module';

@Module({
  imports: [WaitlistModule],
  controllers: [ProfileController],
  providers: [ProfileRepository, ProfileService],
  exports: [ProfileRepository, ProfileService],
})
export class ProfileModule {}
