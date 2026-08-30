import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from './config/env.validation';
import { FirebaseModule } from './auth/firebase.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { ProfileModule } from './profile/profile.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { TrackModule } from './track/track.module';
import { AdminModule } from './admin/admin.module';
import { MuralModule } from './mural/mural.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailsModule } from './emails/emails.module';
import { LegalModule } from './legal/legal.module';
import { GamesModule } from './games/games.module';
import { LegalAcceptanceGuard } from './legal/legal-acceptance.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    FirebaseModule,
    WaitlistModule,
    ProfileModule,
    AuthModule,
    BillingModule,
    TrackModule,
    AdminModule,
    MuralModule,

    NotificationsModule,
    EmailsModule,
    LegalModule,
    GamesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      // O bloqueio por falta de aceite (spec 018, decisao 8).
      //
      // **Global e depois do FirebaseAuthGuard**, que e por controller: quando
      // este roda, `request.user` ja foi preenchido por quem autenticou. Ele
      // deixa passar a rota que nao tem usuario -- a publica --, entao ser
      // global nao o torna um segundo autenticador.
      //
      // Aqui e onde se desliga o produto inteiro por engano. A lista de rotas
      // isentas mora no proprio guard, com o motivo de cada linha ao lado.
      provide: APP_GUARD,
      useClass: LegalAcceptanceGuard,
    },
  ],
})
export class AppModule {}
