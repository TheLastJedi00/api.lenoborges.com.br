import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from './entities/profile.entity';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { WaitlistModule } from '../waitlist/waitlist.module';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), WaitlistModule],
  controllers: [ProfileController],
  providers: [ProfileRepository, ProfileService],
  exports: [ProfileRepository, ProfileService],
})
export class ProfileModule {}
