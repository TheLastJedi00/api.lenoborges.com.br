import { Module } from '@nestjs/common';
import { TrainingDataModule } from './training-data.module';
import { TrainingService } from './training.service';
import { TrainingController } from './training.controller';
import { AdminTrainingController } from './admin-training.controller';
import { ProfileModule } from '../profile/profile.module';
import { GamesDataModule } from '../games/games-data.module';

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
 */
@Module({
  imports: [TrainingDataModule, GamesDataModule, ProfileModule],
  controllers: [TrainingController, AdminTrainingController],
  providers: [TrainingService],
  exports: [TrainingService, TrainingDataModule],
})
export class TrainingModule {}
