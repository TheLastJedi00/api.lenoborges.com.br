import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Profile } from './entities/profile.entity';
import { ProfileRepository } from './profile.repository';
import { WaitlistModule } from '../waitlist/waitlist.module';

@Module({
  imports: [TypeOrmModule.forFeature([Profile]), WaitlistModule],
  providers: [ProfileRepository],
  exports: [ProfileRepository],
})
export class ProfileModule {}
