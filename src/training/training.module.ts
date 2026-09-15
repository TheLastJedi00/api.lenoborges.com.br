import { Module } from '@nestjs/common';
import { TrainingDataModule } from './training-data.module';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';
import { AdminTrainingController } from './admin-training.controller';
import { GeminiService } from './gemini.service';
import { ProfileModule } from '../profile/profile.module';
import { GamesDataModule } from '../games/games-data.module';
import { StorageModule } from '../storage/storage.module';

/**
 * A Arena de Treinamento (spec 023).
 *
 * O `ProfileModule` entra porque comentar exige tier pago e o comentário
 * fotografa o nome de quem escreveu -- as duas coisas saem de uma leitura do
 * perfil. **A seta aponta só para um lado**: o `ProfileModule` importa o
 * `TrainingDataModule`, e não este, e é isso que evita o ciclo de arquivos que
 * derrubaria o boot sem nenhum teste unitário notar.
 *
 * O `GamesDataModule` traz o `RankingRepository`: concluir um desafio soma XP no
 * perfil e no placar **no mesmo lote**. Ele não importa nada e só depende do
 * `FirebaseService`, que é global, então pode entrar aqui sem reabrir volta
 * nenhuma.
 *
 * O `StorageModule` (spec 027) entra para a foto de resultado. Ele não importa
 * nada e o `FirebaseService` é global, então não reabre volta nenhuma -- mesma
 * forma do `GamesDataModule` logo acima.
 *
 * O `GeminiService` (spec 025) é provido aqui e **injetado só no
 * `AdminTrainingController`**: nenhuma rota pública o alcança, e é isso que
 * mantém a chamada paga atrás do `AdminGuard`. Ele só depende do
 * `ConfigService`, e o `ConfigModule` é global -- não há import de módulo a
 * fazer.
 */
@Module({
  imports: [TrainingDataModule, GamesDataModule, ProfileModule, StorageModule],
  controllers: [TrainingController, AdminTrainingController],
  providers: [TrainingService, GeminiService],
  exports: [TrainingService, TrainingDataModule],
})
export class TrainingModule {}
