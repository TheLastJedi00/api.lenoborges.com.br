import { Injectable, NotFoundException } from '@nestjs/common';
import { BADGE_TITLES } from '../track/track.constants';
import type { BadgeId } from '../track/track.constants';
import { ProfileRepository } from '../profile/profile.repository';
import {
  CHALLENGE_BADGE_IDS,
  DIFFICULTIES,
  MIN_QUESTIONS_PER_DIFFICULTY,
  ROUND_NUMBERS,
  ROUND_DIFFICULTY,
  isChallengeBadgeId,
} from './games.constants';
import type { RoundNumber } from './games.constants';
import { GymChallengeRepository } from './gym-challenge.repository';
import { GymQuestionRepository } from './gym-question.repository';
import type { DifficultyCounts } from './gym-question.repository';
import { ChallengeConfigRepository } from './challenge-config.repository';
import type { GymChallenge } from './entities/gym-challenge.entity';
import type {
  ChallengeStateDto,
  ChallengeStatus,
} from './dto/challenge-state.dto';

/**
 * O GYM Challenge do ponto de vista de quem joga (spec 022).
 *
 * A administracao das questoes e do `GymQuestionService`; aqui mora o estado do
 * membro -- o que ele pode abrir, onde ele parou, e o que acontece quando ele
 * responde.
 */
@Injectable()
export class GamesService {
  constructor(
    private readonly challenges: GymChallengeRepository,
    private readonly questions: GymQuestionRepository,
    private readonly configs: ChallengeConfigRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  protected assertBadge(badgeId: string): BadgeId {
    if (!isChallengeBadgeId(badgeId)) {
      throw new NotFoundException('Insígnia não encontrada.');
    }

    return badgeId;
  }

  /**
   * As oito insignias com o estado do desafio de cada uma.
   *
   * As leituras vao juntas num `Promise.all`: as tres sao independentes, e
   * serializa-las custaria tres viagens em toda abertura da tela.
   *
   * **A contagem de questoes e por insignia, e sao oito chamadas de agregado.**
   * Uma consulta so, agrupada, nao existe no Firestore; e o agregado cobra por
   * indice lido e nao por documento, entao oito contagens custam menos que ler
   * uma insignia inteira.
   */
  async listChallenges(uid: string): Promise<ChallengeStateDto[]> {
    const [profile, challengeMap, configMap, countsList] = await Promise.all([
      this.profiles.findById(uid),
      this.challenges.getMany(CHALLENGE_BADGE_IDS, uid),
      this.configs.getMany(CHALLENGE_BADGE_IDS),
      Promise.all(
        CHALLENGE_BADGE_IDS.map((badgeId) =>
          this.questions.countByDifficulty(badgeId),
        ),
      ),
    ]);

    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    const currentXp = profile.entry.xp;

    return CHALLENGE_BADGE_IDS.map((badgeId, index) =>
      this.toStateDto({
        badgeId,
        challenge: challengeMap.get(badgeId)!,
        requiredXp: configMap.get(badgeId)!.requiredXp,
        counts: countsList[index],
        currentXp,
        // A listagem nao le a rodada aberta de cada insignia -- seriam oito
        // consultas de subcolecao para pintar oito cards. O botao "Continuar"
        // aparece na tela do desafio, que le uma so.
        hasActiveRound: false,
      }),
    );
  }

  async getChallenge(uid: string, badgeId: string): Promise<ChallengeStateDto> {
    const badge = this.assertBadge(badgeId);

    const [profile, { entry: challenge }, config, counts, activeRound] =
      await Promise.all([
        this.profiles.findById(uid),
        this.challenges.get(badge, uid),
        this.configs.get(badge),
        this.questions.countByDifficulty(badge),
        this.challenges.listActiveRound(badge, uid),
      ]);

    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    return this.toStateDto({
      badgeId: badge,
      challenge,
      requiredXp: config.entry.requiredXp,
      counts,
      currentXp: profile.entry.xp,
      // Uma rodada esta **aberta** quando ha questoes e pelo menos uma sem
      // resposta. Dez respondidas e uma rodada que terminou e cuja limpeza
      // falhou -- e nesse caso o botao certo e "Iniciar", nao "Continuar".
      hasActiveRound:
        activeRound.entries.length > 0 &&
        activeRound.entries.some((question) => question.answeredAt === null),
    });
  }

  /**
   * Se o desafio desta insignia existe: os **tres** niveis no minimo.
   *
   * Noventa questoes faceis e nenhuma dificil somam 90 e nao montam uma rodada
   * 3. Um `total >= 90` aqui acenderia o card e estouraria a terceira rodada por
   * falta de questao -- depois de o membro ter vencido as duas primeiras.
   */
  protected isReady(counts: DifficultyCounts): boolean {
    return DIFFICULTIES.every(
      (difficulty) => counts[difficulty] >= MIN_QUESTIONS_PER_DIFFICULTY,
    );
  }

  protected toStateDto({
    badgeId,
    challenge,
    requiredXp,
    counts,
    currentXp,
    hasActiveRound,
  }: {
    badgeId: BadgeId;
    challenge: GymChallenge;
    requiredXp: number;
    counts: DifficultyCounts;
    currentXp: number;
    hasActiveRound: boolean;
  }): ChallengeStateDto {
    const ready = this.isReady(counts);
    const rounds = ROUND_NUMBERS.map((round) => {
      const result = challenge.roundResults[round];

      return {
        round,
        difficulty: ROUND_DIFFICULTY[round],
        passed: result?.passed ?? false,
        score: result?.score ?? null,
      };
    });

    return {
      badgeId,
      badgeTitle: BADGE_TITLES[badgeId],
      status: this.statusOf({ challenge, ready, requiredXp, currentXp }),
      currentRound: challenge.currentRound,
      rounds,
      requiredXp,
      currentXp,
      badgeUnlocked: challenge.badgeUnlocked,
      hasActiveRound,
      // Refazer uma rodada ja aprovada e treino, e nao rende XP (decisao 21).
      replay: rounds[challenge.currentRound - 1].passed,
    };
  }

  /**
   * A ordem das perguntas decide o estado, e ela nao e arbitraria.
   *
   * **`conquistada` vem primeiro, e antes de `ready`.** O admin pode apagar
   * questoes depois de alguem conquistar a insignia, e o ponto Q.8 e explicito:
   * o desafio volta a "Em breve" e **quem ja desbloqueou nao e afetado**. Testar
   * `ready` antes faria a conquista de um membro desaparecer da tela dele por
   * causa de uma edicao no painel.
   */
  protected statusOf({
    challenge,
    ready,
    requiredXp,
    currentXp,
  }: {
    challenge: GymChallenge;
    ready: boolean;
    requiredXp: number;
    currentXp: number;
  }): ChallengeStatus {
    if (challenge.badgeUnlocked) {
      return 'conquistada';
    }

    if (!ready) {
      return 'em-breve';
    }

    if (currentXp < requiredXp) {
      return 'xp-insuficiente';
    }

    return 'disponivel';
  }

  /** A dificuldade que a rodada corrente sorteia. */
  protected difficultyOf(round: RoundNumber) {
    return ROUND_DIFFICULTY[round];
  }
}
