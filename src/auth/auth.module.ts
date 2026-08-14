import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { AuthController } from './auth.controller';
import { ProfileModule } from '../profile/profile.module';
import { WaitlistModule } from '../waitlist/waitlist.module';

@Module({
  imports: [ProfileModule, WaitlistModule],
  controllers: [AuthController],
  providers: [SupabaseService, AuthService, CookieService],
  exports: [SupabaseService, AuthService, CookieService],
})
export class AuthModule {}
