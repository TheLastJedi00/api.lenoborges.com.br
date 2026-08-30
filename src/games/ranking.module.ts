import { Module } from '@nestjs/common';
import { RankingRepository } from './ranking.repository';

/**
 * O placar num modulo proprio, **sem `imports`** (spec 022).
 *
 * **E o mesmo remedio do `WatchedVideoModule` da spec 019 e do
 * `MemberDirectoryModule` da spec 015, pela mesma razao escrita la.** Tres
 * lugares diferentes precisam escrever no ranking:
 *
 * - o `GamesService`, quando uma questao acertada paga XP;
 * - o `WatchedVideoService`, quando um video assistido paga XP;
 * - o `ProfileService`, quando alguem escolhe a gamertag ou exclui a conta.
 *
 * Pendurar o `RankingRepository` no `GamesModule` faria os outros dois
 * importarem o `GamesModule` inteiro -- e o `GamesModule` importa o
 * `ProfileModule`, que importa o `WatchedVideoModule`. Isso fecha um ciclo **de
 * arquivos**, e `forwardRef` nao resolve ciclo de arquivo: quando um dos modulos
 * ainda esta sendo avaliado, o `import` que o outro faz dele devolve
 * `undefined`, e o Nest morre no boot com `UndefinedModuleException`.
 *
 * **Nenhum teste unitario pega isso**, porque nenhum deles monta o `AppModule` --
 * foi exatamente o que aconteceu na spec 019, com a suite inteira verde. O
 * `app.module.spec.ts` existe desde entao e monta.
 *
 * Um modulo de um provider e sem `imports` corta o ciclo na raiz em vez de
 * esconde-lo: o `RankingRepository` so depende do `FirebaseService`, que e
 * global. **`forwardRef` que existe por acidente de arrumacao e divida
 * indistinguivel do `forwardRef` que existe por decisao.**
 */
@Module({
  providers: [RankingRepository],
  exports: [RankingRepository],
})
export class RankingModule {}
