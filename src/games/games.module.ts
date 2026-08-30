import { Module } from '@nestjs/common';
import { GymQuestionRepository } from './gym-question.repository';
import { GymQuestionService } from './gym-question.service';
import { GeminiService } from './gemini.service';
import { ChallengeConfigRepository } from './challenge-config.repository';
import { ChallengeConfigService } from './challenge-config.service';
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
  controllers: [AdminGamesController],
  providers: [
    GymQuestionRepository,
    GymQuestionService,
    GeminiService,
    ChallengeConfigRepository,
    ChallengeConfigService,
  ],
  exports: [
    GymQuestionRepository,
    GymQuestionService,
    ChallengeConfigRepository,
  ],
})
export class GamesModule {}
