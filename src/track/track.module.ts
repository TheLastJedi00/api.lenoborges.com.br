import { Module } from '@nestjs/common';
import { BadgeVideoRepository } from './badge-video.repository';
import { BadgeVideoService } from './badge-video.service';
import { TrackController } from './track.controller';
import { AdminTrackController } from './admin-track.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailsModule } from '../emails/emails.module';
import { MuralModule } from '../mural/mural.module';

@Module({
  // O `MuralModule` entra pela spec 017: publicar um video de resposta le a
  // pergunta uma vez, para fotografa-la (`AnsweredQuestion`) e para fechar o
  // `answerVideoId` do outro lado.
  //
  // **E o `MuralRepository` que se usa, e nao o `MuralService`.** O que se quer
  // aqui e uma leitura por caminho; passar pelo service traria junto a derivacao
  // de fase, o `hasVoted` e a montagem de DTO -- nada disso serve para tirar uma
  // foto. E sem `forwardRef`: nenhum modulo importa o `TrackModule`, entao a
  // seta so aponta para um lado.
  imports: [NotificationsModule, EmailsModule, MuralModule],
  controllers: [TrackController, AdminTrackController],
  providers: [BadgeVideoRepository, BadgeVideoService],
  exports: [BadgeVideoRepository, BadgeVideoService],
})
export class TrackModule {}
