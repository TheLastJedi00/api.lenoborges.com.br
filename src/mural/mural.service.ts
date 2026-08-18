import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MuralRepository } from './mural.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { previousWeekId, weekEndsAt, weekIdOf } from './week-id';
import { phaseOf } from './mural-phase';
import { isBadgeId } from '../track/track.constants';
import { MuralQuestion } from './entities/mural-question.entity';
import { MuralQuestionDto } from './dto/mural-question.dto';
import { MuralStateDto } from './dto/mural-state.dto';
import { WinnerDto } from './dto/winner.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

@Injectable()
export class MuralService {
  constructor(
    private readonly repository: MuralRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * O estado do ciclo para este usuário.
   *
   * `canAsk` sai daqui pronto, e não é recalculado no front: duas
   * implementações da mesma regra divergem na primeira exceção.
   */
  async getState(uid: string, now: Date = new Date()): Promise<MuralStateDto> {
    const currentWeekId = weekIdOf(now);
    const mine = await this.repository.findMine(currentWeekId, uid);
    const paid = await this.isPaid(uid);

    return {
      currentWeekId,
      votingWeekId: previousWeekId(currentWeekId),
      currentWeekEndsAt: weekEndsAt(currentWeekId).toISOString(),
      // Já perguntou nesta semana também zera o `canAsk`: o botão não deve
      // abrir um formulário que vai receber 409.
      canAsk: paid && !mine.found,
      myQuestionId: mine.entry?.id ?? null,
    };
  }

  async listQuestions(
    uid: string,
    fase: 'coleta' | 'votacao',
    now: Date = new Date(),
  ): Promise<MuralQuestionDto[]> {
    const currentWeekId = weekIdOf(now);
    const weekId =
      fase === 'coleta' ? currentWeekId : previousWeekId(currentWeekId);

    const questions = await this.repository.listByWeek(
      weekId,
      fase === 'votacao',
    );

    // Um `getAll` por caminho para a página inteira, e nunca N leituras em laço
    // nem uma consulta por autor. Sem isto o front não sabe qual coração pintar.
    const myVotes = await this.repository.findMyVotes(
      questions.map((question) => question.id),
      uid,
    );

    return questions.map((question) =>
      this.toDto(question, uid, myVotes.has(question.id), now),
    );
  }

  /**
   * As vencedoras das semanas encerradas.
   *
   * Semana em branco entra na lista com `question: null`. Ela é informação
   * honesta — nenhum vídeo é devido — e esconder a semana faria o histórico
   * parecer ter buracos.
   */
  async listWinners(
    uid: string,
    semanas = 8,
    now: Date = new Date(),
  ): Promise<WinnerDto[]> {
    const encerradas: string[] = [];
    let weekId = previousWeekId(previousWeekId(weekIdOf(now)));

    for (let i = 0; i < semanas; i += 1) {
      encerradas.push(weekId);
      weekId = previousWeekId(weekId);
    }

    const winners = await Promise.all(
      encerradas.map(async (semana) => {
        const winner = await this.repository.findWinner(semana);
        return {
          weekId: semana,
          question: winner.entry
            ? this.toDto(winner.entry, uid, false, now)
            : null,
        };
      }),
    );

    return winners;
  }

  async createQuestion(
    uid: string,
    dto: CreateQuestionDto,
    now: Date = new Date(),
  ): Promise<MuralQuestionDto> {
    if (!isBadgeId(dto.badgeId)) {
      throw new BadRequestException(
        `Insígnia "${dto.badgeId}" não existe na trilha.`,
      );
    }

    const profile = await this.profiles.findById(uid);
    if (!profile.found || !profile.entry) {
      throw new NotFoundException('Perfil não encontrado.');
    }

    // O portão. A mensagem diz o que fazer, e não só que não pode: um 403 sem
    // caminho de saída é a forma mais cara de perder um upgrade.
    if (profile.entry.tier === 'dev-tier') {
      throw new ForbiddenException(
        'O Dev Tier vota no Mural, mas não escreve pergunta. Veja o Financeiro para assinar.',
      );
    }

    // O weekId vem SEMPRE do servidor, nunca do corpo da requisição: cliente que
    // escolhe a própria semana escolhe também votar na semana errada.
    const weekId = weekIdOf(now);

    try {
      const created = await this.repository.create({
        weekId,
        badgeId: dto.badgeId,
        authorUid: uid,
        authorName: firstName(profile.entry.name),
        title: dto.title,
        body: dto.body?.length ? dto.body : null,
      });

      return this.toDto(created.entry, uid, false, now);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        throw new ConflictException(
          'Você já perguntou esta semana. Dá para editar a sua pergunta enquanto a semana não virar.',
        );
      }
      throw error;
    }
  }

  /**
   * Reescreve a própria pergunta, **só enquanto a semana está em coleta**.
   *
   * Depois da virada ela já está em votação, e mexer no texto invalidaria os
   * votos que ela recebeu — quem votou votou naquilo.
   */
  async updateQuestion(
    uid: string,
    questionId: string,
    dto: UpdateQuestionDto,
    now: Date = new Date(),
  ): Promise<MuralQuestionDto> {
    const found = await this.repository.findById(questionId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    if (found.entry.authorUid !== uid) {
      throw new ForbiddenException('Essa pergunta não é sua.');
    }

    if (phaseOf(found.entry.weekId, now) !== 'coleta') {
      throw new ConflictException(
        'A semana virou e a sua pergunta já está em votação — o texto não muda mais.',
      );
    }

    const updated = await this.repository.update(questionId, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined
        ? { body: dto.body.length ? dto.body : null }
        : {}),
    });

    return this.toDto(updated.entry, uid, false, now);
  }

  async remove(questionId: string): Promise<void> {
    const found = await this.repository.findById(questionId);
    if (!found.found) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    await this.repository.remove(questionId);
  }

  private async isPaid(uid: string): Promise<boolean> {
    const profile = await this.profiles.findById(uid);
    return !!profile.entry && profile.entry.tier !== 'dev-tier';
  }

  private toDto(
    question: MuralQuestion,
    uid: string,
    hasVoted: boolean,
    now: Date,
  ): MuralQuestionDto {
    return {
      id: question.id,
      weekId: question.weekId,
      phase: phaseOf(question.weekId, now),
      badgeId: question.badgeId,
      authorName: question.authorName,
      title: question.title,
      body: question.body,
      voteCount: question.voteCount,
      hasVoted,
      isMine: question.authorUid === uid,
      answerVideoId: question.answerVideoId,
    };
  }
}

/**
 * Primeiro nome, para o mural.
 *
 * O nome completo numa lista de trinta cartões vira ruído, e o primeiro nome já
 * dá o rosto que a pergunta precisa ter. Perfil sem nome cai em "Membro" — a
 * pergunta existe, e um cartão sem autor pareceria defeito.
 */
function firstName(name: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : 'Membro';
}
