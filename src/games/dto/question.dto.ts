import { ApiProperty } from '@nestjs/swagger';
import { DIFFICULTIES } from '../games.constants';
import type { Difficulty } from '../games.constants';
import { GymQuestion } from '../entities/gym-question.entity';
import { QuestionCounts } from '../gym-question.service';

/**
 * Uma questao como a **administracao** a ve.
 *
 * **Este DTO carrega o `correctIndex`, e e o unico que carrega.** Ele so sai por
 * rotas atras do `AdminGuard`; o que o membro recebe e o `RoundQuestionDto`, que
 * nao tem o campo. Fundir os dois num so com um `if (admin)` transformaria a
 * diferenca entre "quem revisa" e "quem responde" num ramo dentro de uma funcao,
 * e o primeiro esquecimento entrega a resposta certa no trafego de quem esta
 * jogando.
 */
export class QuestionDto {
  @ApiProperty({ example: 'a1b2c3d4e5' })
  id: string;

  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({ enum: DIFFICULTIES, example: 'easy' })
  difficulty: Difficulty;

  @ApiProperty({ example: 'O que um laço `for` controla?' })
  question: string;

  @ApiProperty({ type: [String] })
  alternatives: string[];

  @ApiProperty({
    example: 0,
    description:
      'A posição da alternativa correta. **Só aparece em rota de admin** — o ' +
      'membro nunca a recebe',
  })
  correctIndex: number;

  @ApiProperty({ example: '2026-08-30T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-08-30T12:00:00.000Z' })
  updatedAt: string;
}

export class QuestionCountsDto {
  @ApiProperty({ example: 30 })
  easy: number;

  @ApiProperty({ example: 28 })
  medium: number;

  @ApiProperty({ example: 15 })
  hard: number;

  @ApiProperty({ example: 73 })
  total: number;

  @ApiProperty({
    example: false,
    description:
      'Se o desafio pode sair de "Em breve". Olha os **três níveis** no ' +
      'mínimo de 30, e não o total: 90 fáceis e nenhuma difícil somam 90 e não ' +
      'montam uma rodada 3',
  })
  ready: boolean;
}

export class QuestionListDto {
  @ApiProperty({ type: [QuestionDto] })
  questions: QuestionDto[];

  @ApiProperty({ type: QuestionCountsDto })
  counts: QuestionCountsDto;
}

export function toQuestionDto(entry: GymQuestion): QuestionDto {
  return {
    id: entry.id,
    badgeId: entry.badgeId,
    difficulty: entry.difficulty,
    question: entry.question,
    alternatives: entry.alternatives,
    correctIndex: entry.correctIndex,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function toCountsDto(counts: QuestionCounts): QuestionCountsDto {
  return counts;
}
