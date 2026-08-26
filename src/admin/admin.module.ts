import { Module } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';
import { ProfileModule } from '../profile/profile.module';
import { MemberDirectoryModule } from './member-directory.module';
import { EmailsModule } from '../emails/emails.module';

@Module({
  imports: [ProfileModule, MemberDirectoryModule, EmailsModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminModule {}
