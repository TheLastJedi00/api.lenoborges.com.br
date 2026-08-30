import { Module } from '@nestjs/common';
import { BadgeVideoRepository } from './badge-video.repository';
import { WatchedVideoRepository } from './watched-video.repository';
import { WatchedVideoService } from './watched-video.service';
import { RankingModule } from '../games/ranking.module';

/**
 * O razao do que cada membro assistiu, num modulo proprio (spec 019).
 *
 * **Ele nao importa modulo nenhum, e e por isso que existe.**
 *
 * O caminho obvio era pendurar tudo no `TrackModule` e fazer o `ProfileModule`
 * importa-lo: o `ProfileController` hospeda `PUT /me/watched-videos/:videoId`
 * -- que e `/me`, e o prefixo e dele --, e a exclusao de conta precisa apagar a
 * subcolecao. Isso fecha um ciclo **de arquivos**:
 *
 *     profile.module.ts -> track.module.ts -> emails.module.ts -> profile.module.ts
 *
 * E ciclo de arquivo `forwardRef` nao resolve: quando `profile.module.ts` ainda
 * esta sendo avaliado, o `import` que o `emails.module.ts` faz dele devolve
 * `undefined`, e o Nest morre no boot com `UndefinedModuleException`. Foi
 * exatamente o que aconteceu, e **os 593 testes unitarios continuaram verdes**,
 * porque nenhum deles montava o `AppModule` -- ver `app.module.spec.ts`, que
 * passou a montar.
 *
 * Um modulo de tres providers e sem `imports` corta o ciclo na raiz, em vez de
 * escondê-lo atras de um `forwardRef`. E o mesmo remedio do
 * `MemberDirectoryModule` da spec 015, pela mesma razao escrita la:
 * **`forwardRef` que existe por acidente de arrumacao e divida indistinguivel
 * do `forwardRef` que existe por decisao.**
 *
 * O `BadgeVideoRepository` vem junto porque o `WatchedVideoService` o le para
 * conferir que o video existe antes de pagar XP (decisao 5), e ele tambem nao
 * depende de mais nada alem do `FirebaseService`, que e global.
 */
@Module({
  // O RankingModule nao importa nada e so depende do FirebaseService, que e
  // global -- por isso ele pode entrar aqui sem reabrir o ciclo que este modulo
  // existe para cortar. Ver ranking.module.ts.
  imports: [RankingModule],
  providers: [
    BadgeVideoRepository,
    WatchedVideoRepository,
    WatchedVideoService,
  ],
  exports: [BadgeVideoRepository, WatchedVideoRepository, WatchedVideoService],
})
export class WatchedVideoModule {}
