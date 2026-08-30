import {
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BADGE_TITLES } from '../track/track.constants';
import type { BadgeId } from '../track/track.constants';
import { ProfileRepository } from '../profile/profile.repository';
import {
  CHALLENGE_BADGE_IDS,
  DIFFICULTIES,
  MIN_QUESTIONS_PER_DIFFICULTY,
  PASSING_SCORE,
  QUESTIONS_PER_ROUND,
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
import { sample, shuffleAlternatives } from './shuffle';
import { computeXp } from './xp';
import { nextGrade } from './grade-progression';
import type {
  AnswerQuestionDto,
  AnswerResultDto,
} from './dto/answer-question.dto';
import type { StartRoundDto } from './dto/round-question.dto';
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

  /**
   * Abre a rodada corrente: sorteia dez questoes e as grava (decisoes 4 e 8).
   *
   * A ordem das recusas e do mais estrutural para o mais pessoal, e ela importa
   * para a mensagem que o membro le: "esse desafio ainda nao existe" vem antes
   * de "voce nao tem XP", que vem antes de "voce ja tem uma rodada aberta".
   * Invertida, alguem sem XP numa insignia sem questoes seria mandado treinar
   * para algo que nao vai existir.
   */
  async startRound(uid: string, badgeId: string): Promise<StartRoundDto> {
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

    if (!this.isReady(counts)) {
      throw new ForbiddenException(
        'O GYM Challenge dessa insígnia ainda não está disponível.',
      );
    }

    if (profile.entry.xp < config.entry.requiredXp) {
      throw new ForbiddenException(
        'Você precisa de mais XP para participar desse desafio.',
      );
    }

    // **Rodada aberta e a que tem questao sem responder.** Dez respondidas e uma
    // rodada terminada cuja limpeza falhou, e recusar ali prenderia o membro
    // numa prova acabada sem nenhuma forma de sair.
    const hasOpen =
      activeRound.entries.length > 0 &&
      activeRound.entries.some((question) => question.answeredAt === null);

    if (hasOpen) {
      throw new ConflictException('Você já tem uma rodada em andamento.');
    }

    const round = challenge.currentRound;
    const difficulty = ROUND_DIFFICULTY[round];
    const { entries: pool } = await this.questions.listByBadge(
      badge,
      difficulty,
    );

    const picked = sample(pool, QUESTIONS_PER_ROUND);
    const servedAt = new Date();

    const questions = picked.map((question, index) => {
      const { alternatives, correctAlternativeIndex } = shuffleAlternatives(
        question.alternatives,
        question.correctIndex,
      );

      return {
        index,
        questionId: question.id,
        // A **foto** do enunciado: o admin pode editar a questao enquanto o
        // membro joga, e ninguem ve o texto mudar debaixo do dedo. Mesma ideia
        // da foto da pergunta do Mural na spec 017.
        question: question.question,
        alternatives,
        // Gravado agora e **nunca devolvido antes da resposta**: ele existe para
        // o `answer` poder dizer qual era a certa, e para a conferencia nao
        // depender de reler a questao original numa ordem que ja mudou.
        correctAlternativeIndex,
        servedAt,
        answeredAt: null,
        chosenIndex: null,
        correct: null,
        xpAwarded: null,
        clientElapsedMs: null,
      };
    });

    // Refazer rodada ja aprovada e treino (decisao 21). O flag vive no documento
    // pai e vale para a rodada inteira.
    const replay = challenge.roundResults[round]?.passed ?? false;

    await this.challenges.replaceActiveRound(
      {
        ...challenge,
        replaying: replay,
        startedAt:
          challenge.startedAt.getTime() === 0 ? servedAt : challenge.startedAt,
      },
      questions,
    );

    return {
      round,
      difficulty,
      replay,
      questions: questions.map((question) => ({
        index: question.index,
        question: question.question,
        alternatives: question.alternatives,
      })),
    };
  }

  /**
   * Responde uma questao da rodada aberta (decisoes 3, 10 e 21).
   *
   * **A conferencia e contra `gym_questions`, e nao contra o `active_round`.** O
   * documento efemero guarda onde a certa foi parar depois do embaralhamento --
   * e ele e conferido junto, como segunda opiniao --, mas quem tem a autoridade
   * sobre qual e a resposta certa e a questao original. Confiar so no efemero
   * faria uma escrita indevida naquele documento reescrever o gabarito.
   */
  async answer(
    uid: string,
    badgeId: string,
    dto: AnswerQuestionDto,
  ): Promise<AnswerResultDto> {
    const badge = this.assertBadge(badgeId);

    const [profile, { entry: challenge }, active] = await Promise.all([
      this.profiles.findById(uid),
      this.challenges.get(badge, uid),
      this.challenges.findActiveQuestion(badge, uid, dto.questionIndex),
    ]);

    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    if (!active.found || !active.entry) {
      throw new BadRequestException('Índice de questão inválido.');
    }

    const question = active.entry;

    // **A trava da dupla contagem.** Nao ha `ALREADY_EXISTS` para segurar isto:
    // o documento ja existe, e o lote da resposta o sobrescreve. Sem esta
    // conferencia, reenviar a mesma resposta pagaria XP de novo -- e seria um
    // farm de um clique repetido, sem exploit nenhum.
    if (question.answeredAt !== null) {
      throw new ConflictException('Essa questão já foi respondida.');
    }

    const origin = await this.questions.findById(question.questionId);

    // A questao pode ter sido apagada pelo admin no meio da rodada. O
    // `correctAlternativeIndex` gravado no sorteio e o que sobra, e ele basta:
    // ele foi calculado a partir do gabarito que existia quando a rodada abriu.
    const correctAlternativeIndex = question.correctAlternativeIndex ?? -1;

    // **A conferencia atravessa as duas ordens.** O `chosenIndex` e uma posicao
    // na lista **embaralhada** que a tela recebeu; o `correctIndex` da questao e
    // uma posicao na lista **original**. Compara-los direto acertaria por acaso
    // em uma de quatro questoes -- e essa e a comparacao que a spec chama de
    // erro silencioso. A ponte entre as duas ordens e o texto da alternativa.
    //
    // A comparacao por texto e a certa **aqui** e a armadilha no `shuffle`: la a
    // pergunta e "para onde a certa foi", que texto duplicado responde errado;
    // aqui e "o que ele tocou e o que o gabarito aponta", e as duas listas tem o
    // mesmo conjunto de textos.
    const correct = origin.found
      ? question.alternatives[dto.chosenIndex] ===
        origin.entry!.alternatives[origin.entry!.correctIndex]
      : // Questao apagada pelo admin no meio da rodada: o
        // `correctAlternativeIndex` gravado no sorteio e o que sobra, e ele
        // basta -- foi calculado a partir do gabarito que existia quando a
        // rodada abriu, e e esse gabarito que o membro esta respondendo.
        dto.chosenIndex === correctAlternativeIndex;

    const serverSeconds = (Date.now() - question.servedAt.getTime()) / 1000;

    // Errar nao paga e nao desconta (decisao 3); treino nunca paga (decisao 21).
    const xpAwarded =
      correct && !challenge.replaying
        ? computeXp({ serverSeconds, clientElapsedMs: dto.clientElapsedMs })
        : 0;

    await this.challenges.recordAnswer(
      badge,
      uid,
      {
        ...question,
        answeredAt: new Date(),
        chosenIndex: dto.chosenIndex,
        correct,
        xpAwarded,
        clientElapsedMs: dto.clientElapsedMs,
      },
      xpAwarded,
    );

    const totalXp = profile.entry.xp + xpAwarded;

    const result: AnswerResultDto = {
      correct,
      correctAlternativeIndex,
      xpAwarded,
      replay: challenge.replaying,
      totalXp,
    };

    const { entries } = await this.challenges.listActiveRound(badge, uid);
    const answered = entries.filter((entry) => entry.answeredAt !== null);

    if (answered.length < entries.length) {
      return result;
    }

    return {
      ...result,
      ...(await this.finishRound(challenge, answered, profile.entry.grade)),
    };
  }

  /**
   * Consolida a rodada, e faz tudo o que depende dela **num lote so**
   * (adendo A.7).
   *
   * `roundResults`, `currentRound`, `badgeUnlocked`, o `grade` e o ranking sao
   * escritas diferentes de um fato so. Separa-las cria o estado em que a
   * insignia esta desbloqueada e o `grade` nao subiu -- e **nada no produto
   * corrige isso depois**, porque nao ha um segundo momento em que a pergunta
   * "essa rodada fechou?" seja feita de novo.
   */
  protected async finishRound(
    challenge: GymChallenge,
    answered: { correct: boolean | null }[],
    currentGrade: number,
  ): Promise<Partial<AnswerResultDto>> {
    const score = answered.filter((entry) => entry.correct === true).length;
    const roundPassed = score >= PASSING_SCORE;
    const round = challenge.currentRound;

    await this.challenges.clearActiveRound(challenge.badgeId, challenge.uid);

    // **Treino nao toca o `roundResults`** (decisao 21): a rodada ja foi
    // aprovada, e um replay reprovado nao pode apagar a aprovacao original.
    if (challenge.replaying) {
      await this.challenges.save({ ...challenge, replaying: false });

      return { roundComplete: true, score, roundPassed };
    }

    const roundResults = {
      ...challenge.roundResults,
      [round]: { passed: roundPassed, score, completedAt: new Date() },
    };

    const nextRound = (
      roundPassed && round < 3 ? round + 1 : round
    ) as RoundNumber;

    const badgeUnlocked =
      roundPassed &&
      ROUND_NUMBERS.every((r) => roundResults[r]?.passed === true);

    await this.challenges.save({
      ...challenge,
      currentRound: nextRound,
      roundResults,
      badgeUnlocked: challenge.badgeUnlocked || badgeUnlocked,
      replaying: false,
    });

    if (!badgeUnlocked) {
      return {
        roundComplete: true,
        score,
        roundPassed,
        ...(roundPassed && round < 3 ? { nextRound } : {}),
      };
    }

    const grade = await this.applyGrade(challenge.uid, currentGrade);

    return {
      roundComplete: true,
      score,
      roundPassed,
      badgeUnlocked: true,
      grade,
    };
  }

  /**
   * Avanca o `grade` em cascata, ate onde as insignias desbloqueadas permitirem.
   *
   * Le os oito desafios do membro por caminho -- o mesmo `getMany` da listagem --
   * e nao um `where('badgeUnlocked','==',true)`: seriam um indice novo e uma
   * consulta cujo resultado ja esta a uma leitura de distancia.
   */
  protected async applyGrade(
    uid: string,
    currentGrade: number,
  ): Promise<number> {
    const map = await this.challenges.getMany(CHALLENGE_BADGE_IDS, uid);
    const unlocked = new Set(
      CHALLENGE_BADGE_IDS.filter((badgeId) => map.get(badgeId)!.badgeUnlocked),
    );

    const grade = nextGrade(currentGrade, unlocked);

    if (grade !== currentGrade) {
      await this.profiles.update(uid, { grade });
    }

    return grade;
  }
}
