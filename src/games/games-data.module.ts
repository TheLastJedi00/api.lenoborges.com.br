import { Module } from '@nestjs/common';
import { RankingRepository } from './ranking.repository';
import { GymChallengeRepository } from './gym-challenge.repository';

/**
 * Os repositorios de Jogos que **outros modulos** precisam, num modulo
 * **sem `imports`** (spec 022).
 *
 * **E o mesmo remedio do `WatchedVideoModule` da spec 019 e do
 * `MemberDirectoryModule` da spec 015, pela mesma razao escrita la.** Quem
 * escreve nestas duas colecoes de fora do modulo de jogos:
 *
 * - o `WatchedVideoService`, que soma no ranking o XP de um video assistido;
 * - o `ProfileService`, que insere no ranking ao escolher a gamertag e, ao
 *   excluir a conta, apaga a linha do placar **e** os desafios com a subcolecao
 *   `active_round` dentro.
 *
 * Pendurar os dois no `GamesModule` faria esses modulos importarem o
 * `GamesModule` inteiro -- e ele importa o `ProfileModule`, que importa o
 * `WatchedVideoModule`. Isso fecha um ciclo **de arquivos**, e `forwardRef` nao
 * resolve ciclo de arquivo: quando um dos modulos ainda esta sendo avaliado, o
 * `import` que o outro faz dele devolve `undefined`, e o Nest morre no boot com
 * `UndefinedModuleException`.
 *
 * **Nenhum teste unitario pega isso**, porque nenhum deles monta o `AppModule` --
 * foi exatamente o que aconteceu na spec 019, com a suite inteira verde. O
 * `app.module.spec.ts` existe desde entao e monta.
 *
 * Os dois repositorios so dependem do `FirebaseService`, que e global, entao um
 * modulo sem `imports` corta a volta na raiz em vez de esconde-la:
 * **`forwardRef` que existe por acidente de arrumacao e divida indistinguivel do
 * `forwardRef` que existe por decisao.**
 *
 * **O que NAO entra aqui e a regra.** `GamesService`, `RankingService` e o
 * `GymQuestionService` ficam no `GamesModule`: quem esta de fora precisa gravar
 * um documento, e nao decidir se uma rodada foi aprovada.
 */
@Module({
  providers: [RankingRepository, GymChallengeRepository],
  exports: [RankingRepository, GymChallengeRepository],
})
export class GamesDataModule {}
