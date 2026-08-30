import { forwardRef, Module } from '@nestjs/common';
import { GymQuestionRepository } from './gym-question.repository';
import { GymQuestionService } from './gym-question.service';
import { GeminiService } from './gemini.service';
import { ChallengeConfigRepository } from './challenge-config.repository';
import { ChallengeConfigService } from './challenge-config.service';
import { GymChallengeRepository } from './gym-challenge.repository';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { RankingModule } from './ranking.module';
import { RankingService } from './ranking.service';
import { RankingController } from './ranking.controller';
import { ProfileModule } from '../profile/profile.module';
import { AdminGamesController } from './admin-games.controller';

/**
 * O modulo de Jogos (spec 022).
 *
 * **Ele nao importa nada, e isso e o desenho.** O `FirebaseModule` e global, e o
 * que ele precisa do resto do produto -- o perfil, para o XP e o `grade` -- entra
 * pelo `ProfileModule` nas fases seguintes, com a seta apontando **para ca**: o
 * `ProfileModule` ja importa o `TrackModule` pela mesma razao, e fechar a volta
 * custou um boot quebrado na spec 019, que nenhum teste unitario pega porque
 * nenhum deles monta o `AppModule`.
 */
@Module({
  imports: [forwardRef(() => ProfileModule), RankingModule],
  controllers: [AdminGamesController, GamesController, RankingController],
  providers: [
    GymQuestionRepository,
    GymQuestionService,
    GeminiService,
    ChallengeConfigRepository,
    ChallengeConfigService,
    GymChallengeRepository,
    GamesService,
    RankingService,
  ],
  exports: [
    GymQuestionRepository,
    GymQuestionService,
    ChallengeConfigRepository,
    GymChallengeRepository,
    GamesService,
    RankingModule,
  ],
})
export class GamesModule {}
