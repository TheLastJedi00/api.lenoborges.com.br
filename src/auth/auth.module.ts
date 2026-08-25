import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CookieService } from './cookie.service';
import { AuthController } from './auth.controller';
import { ProfileModule } from '../profile/profile.module';
import { WaitlistModule } from '../waitlist/waitlist.module';

@Module({
  // O ciclo com o ProfileModule nasceu na spec 013: o perfil passou a
  // reautenticar pelo AuthService. Ver o comentario em profile.module.ts.
  imports: [forwardRef(() => ProfileModule), WaitlistModule],
  controllers: [AuthController],
  providers: [AuthService, CookieService],
  exports: [AuthService, CookieService],
})
export class AuthModule {}
