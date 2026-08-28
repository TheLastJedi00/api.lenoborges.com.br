import { Module } from '@nestjs/common';
import { BadgeVideoService } from './badge-video.service';
import { WatchedVideoModule } from './watched-video.module';
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
  //
  // **Este modulo NAO importa o `ProfileModule`, e isso e decisao** (spec 019).
  // A seta aponta so para um lado: o `ProfileModule` importa este, porque o
  // `ProfileController` hospeda `PUT /me/watched-videos/:videoId` -- que e `/me`
  // -- e porque a exclusao de conta precisa apagar o razao.
  //
  // Fechar a volta custou um boot quebrado, e vale registrar: com o
  // `ProfileRepository` injetado no `WatchedVideoService` so para reler o `xp`,
  // o ciclo de arquivos `ProfileModule -> TrackModule -> EmailsModule ->
  // ProfileModule` faz `ProfileModule` chegar `undefined` no `EmailsModule`, e a
  // aplicacao morre no boot. **Nenhum teste unitario pega isso**, porque nenhum
  // deles monta o `AppModule`. Quem le o `xp` e o `WatchedVideoRepository`, que
  // ja e quem escreve o incremento.
  imports: [NotificationsModule, EmailsModule, MuralModule, WatchedVideoModule],
  controllers: [TrackController, AdminTrackController],
  providers: [BadgeVideoService],
  // Reexporta o modulo pequeno: quem importava o `TrackModule` para pegar o
  // `BadgeVideoRepository` continua pegando, sem saber que ele mudou de casa.
  exports: [BadgeVideoService, WatchedVideoModule],
})
export class TrackModule {}
