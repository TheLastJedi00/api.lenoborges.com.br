import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MuralRepository } from './mural.repository';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import { phaseOf } from './mural-phase';

@Injectable()
export class VoteService {
  constructor(private readonly repository: MuralRepository) {}

  /**
   * Vota numa pergunta da semana em votação.
   *
   * A escrita é um `WriteBatch` atômico no repository: o documento do voto e o
   * `increment` do contador entram juntos. Se o voto já existe, o `create()`
   * falha e o lote inteiro falha — o contador não se mexe, que é a proteção
   * contra contar duas vezes.
   *
   * **Votar duas vezes não é erro para quem clica**, e por isso o segundo voto
   * responde como o primeiro em vez de estourar: do ponto de vista da pessoa, o
   * coração já está pintado. O que não pode acontecer é o número subir de novo.
   */
  async vote(
    questionId: string,
    uid: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.assertVotingPhase(questionId, now);

    try {
      await this.repository.vote(questionId, uid);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ALREADY_EXISTS
      ) {
        // Já votou. O estado final é o desejado, então não é falha.
        return;
      }
      throw error;
    }
  }

  /**
   * Desfaz o voto. **Idempotente de propósito.**
   *
   * Desvotar sem ter votado não é erro: o estado final é o mesmo que a pessoa
   * pediu. E é essa idempotência que impede o contador de ficar negativo — sem
   * a conferência antes, dois `DELETE` seguidos decrementariam duas vezes um
   * voto que existia uma vez só.
   */
  async unvote(
    questionId: string,
    uid: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.assertVotingPhase(questionId, now);

    const voted = await this.repository.hasVoted(questionId, uid);
    if (!voted) {
      return;
    }

    await this.repository.unvote(questionId, uid);
  }

  /**
   * Só a semana em votação aceita voto.
   *
   * A semana em coleta não aceita porque quem publicasse domingo de manhã
   * acumularia sete dias de vantagem sobre quem publicasse sábado à noite. A
   * encerrada não aceita porque a vencedora dela já foi decidida.
   */
  private async assertVotingPhase(
    questionId: string,
    now: Date,
  ): Promise<void> {
    const found = await this.repository.findById(questionId);
    if (!found.found || !found.entry) {
      throw new NotFoundException('Pergunta não encontrada.');
    }

    const phase = phaseOf(found.entry.weekId, now);
    if (phase !== 'votacao') {
      throw new ConflictException(
        phase === 'coleta'
          ? 'A votação desta semana começa quando ela virar, no domingo.'
          : 'Essa semana já encerrou, e a votação dela também.',
      );
    }
  }
}
