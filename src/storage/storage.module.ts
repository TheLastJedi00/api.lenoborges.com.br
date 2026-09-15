import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * O acesso ao bucket, para quem precisar dele (spec 027).
 *
 * **Este modulo nao importa nada, e e isso que ele resolve.** Ele e importado
 * pelo `ProfileModule` (avatar) e pelo `TrainingModule` (foto de resultado), e os
 * dois ja estao no meio da teia de `forwardRef` que a spec 013 abriu. Um import
 * de volta aqui fecharia o ciclo de arquivos que derruba o boot **sem nenhum
 * teste unitario notar** -- foi o que aconteceu na spec 019 e e a razao de o
 * `WatchedVideoModule`, o `GamesDataModule` e o `TrainingDataModule` existirem
 * com esta mesma forma. O `FirebaseModule` e `@Global()`, entao o
 * `StorageService` alcanca o `FirebaseService` sem declarar import nenhum.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
