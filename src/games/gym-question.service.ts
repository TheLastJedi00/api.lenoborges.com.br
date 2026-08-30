import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BadgeId } from '../track/track.constants';
import {
  DIFFICULTIES,
  Difficulty,
  MAX_QUESTIONS_PER_DIFFICULTY,
  MIN_QUESTIONS_PER_DIFFICULTY,
  isChallengeBadgeId,
} from './games.constants';
import { GymQuestion } from './entities/gym-question.entity';
import { GymQuestionRepository } from './gym-question.repository';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

/** O que a tela do admin mostra no topo da pagina de questoes. */
export interface QuestionCounts {
  easy: number;
  medium: number;
  hard: number;
  total: number;
  /** Se o desafio desta insignia pode sair de "Em breve" (decisao 5). */
  ready: boolean;
}

/**
 * As regras do banco de questoes (spec 022, decisoes 5 e 6).
 *
 * O repositorio grava; aqui mora o que pode ser gravado.
 */
@Injectable()
export class GymQuestionService {
  constructor(private readonly repository: GymQuestionRepository) {}

  /**
   * Traduz o `badgeId` da URL em insignia com desafio, ou 404.
   *
   * **Duas recusas com o mesmo status, e as duas importam.** Um id que nao
   * existe na trilha e erro de digitacao; um id que existe mas e da Elite Four e
   * uma insignia real **sem GYM Challenge** (ponto Q.2). Sem a segunda, o admin
   * cadastraria noventa questoes para `final-gcp` e o card nunca apareceria em
   * tela nenhuma -- sem erro, sem log, e a descoberta seria ele perguntando por
   * que nao funciona.
   */
  private assertBadge(badgeId: string): BadgeId {
    if (!isChallengeBadgeId(badgeId)) {
      throw new NotFoundException('Insígnia não encontrada.');
    }

    return badgeId;
  }

  async list(badgeId: string, difficulty?: Difficulty): Promise<GymQuestion[]> {
    const badge = this.assertBadge(badgeId);
    const { entries } = await this.repository.listByBadge(badge, difficulty);

    return entries;
  }

  async counts(badgeId: string): Promise<QuestionCounts> {
    const badge = this.assertBadge(badgeId);
    const counts = await this.repository.countByDifficulty(badge);

    return {
      ...counts,
      total: counts.easy + counts.medium + counts.hard,
      // **O `ready` olha os tres niveis, e nao a soma**, e a diferenca e a
      // rodada 3: noventa questoes faceis e nenhuma dificil somam 90 e nao
      // montam um desafio. Um `total >= 90` aqui deixaria o card acender e a
      // terceira rodada estourar por falta de questao.
      ready: DIFFICULTIES.every(
        (difficulty) => counts[difficulty] >= MIN_QUESTIONS_PER_DIFFICULTY,
      ),
    };
  }

  async create(badgeId: string, dto: CreateQuestionDto): Promise<GymQuestion> {
    const badge = this.assertBadge(badgeId);
    await this.assertRoom(badge, { [dto.difficulty]: 1 });

    const { entry } = await this.repository.create({
      badgeId: badge,
      difficulty: dto.difficulty,
      question: dto.question,
      alternatives: dto.alternatives,
      correctIndex: dto.correctIndex,
    });

    return entry;
  }

  /**
   * Grava o rascunho aprovado da IA, ou a lista manual, num lote so.
   *
   * **Tudo ou nada, inclusive na conferencia de teto.** Gravar as que cabem e
   * descartar o resto deixaria o admin com um rascunho parcialmente salvo e
   * nenhuma forma de saber quais entraram -- e o rascunho ja foi perdido do lado
   * dele, porque ele nao mora em lugar nenhum (decisao 10).
   */
  async createMany(
    badgeId: string,
    items: CreateQuestionDto[],
  ): Promise<GymQuestion[]> {
    const badge = this.assertBadge(badgeId);

    if (items.length === 0) {
      throw new BadRequestException('Nenhuma questão para gravar.');
    }

    const wanted = items.reduce<Partial<Record<Difficulty, number>>>(
      (acc, item) => ({
        ...acc,
        [item.difficulty]: (acc[item.difficulty] ?? 0) + 1,
      }),
      {},
    );

    await this.assertRoom(badge, wanted);

    const { entries } = await this.repository.createMany(
      items.map((item) => ({
        badgeId: badge,
        difficulty: item.difficulty,
        question: item.question,
        alternatives: item.alternatives,
        correctIndex: item.correctIndex,
      })),
    );

    return entries;
  }

  async update(
    badgeId: string,
    questionId: string,
    dto: UpdateQuestionDto,
  ): Promise<GymQuestion> {
    const badge = this.assertBadge(badgeId);
    const current = await this.findInBadge(badge, questionId);

    // A validacao cruzada que o DTO nao consegue fazer: `correctIndex` precisa
    // caber na lista **que vai ficar gravada**, e ela pode ser a nova ou a atual.
    const alternatives = dto.alternatives ?? current.alternatives;
    const correctIndex = dto.correctIndex ?? current.correctIndex;

    if (correctIndex >= alternatives.length) {
      throw new BadRequestException(
        'A alternativa correta aponta para fora da lista.',
      );
    }

    // Mudar de nivel e ocupar uma vaga no nivel de destino.
    if (dto.difficulty && dto.difficulty !== current.difficulty) {
      await this.assertRoom(badge, { [dto.difficulty]: 1 });
    }

    const { entry } = await this.repository.update(questionId, dto);

    return entry!;
  }

  async remove(badgeId: string, questionId: string): Promise<void> {
    const badge = this.assertBadge(badgeId);
    await this.findInBadge(badge, questionId);

    await this.repository.delete(questionId);
  }

  /**
   * A questao existe **e pertence a esta insignia**.
   *
   * O `badgeId` vem do caminho da rota, e sem esta conferencia um id colado na
   * URL errada editaria a questao de outra insignia respondendo 200. E a mesma
   * ideia do `findById` conferido do `BadgeVideoService`.
   */
  private async findInBadge(
    badgeId: BadgeId,
    questionId: string,
  ): Promise<GymQuestion> {
    const { found, entry } = await this.repository.findById(questionId);

    if (!found || entry!.badgeId !== badgeId) {
      throw new NotFoundException('Questão não encontrada.');
    }

    return entry!;
  }

  private async assertRoom(
    badgeId: BadgeId,
    wanted: Partial<Record<Difficulty, number>>,
  ): Promise<void> {
    const counts = await this.repository.countByDifficulty(badgeId);

    for (const difficulty of DIFFICULTIES) {
      const extra = wanted[difficulty] ?? 0;

      if (extra === 0) {
        continue;
      }

      if (counts[difficulty] + extra > MAX_QUESTIONS_PER_DIFFICULTY) {
        throw new ConflictException(
          `O nível já tem o máximo de ${MAX_QUESTIONS_PER_DIFFICULTY} questões.`,
        );
      }
    }
  }
}
