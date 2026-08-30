import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DIFFICULTIES } from '../games.constants';
import type { Difficulty } from '../games.constants';
import { trim } from './trim';
import { QuestionDto } from './question.dto';

export class GenerateQuestionsDto {
  @ApiProperty({
    example:
      'Gere questões sobre herança e polimorfismo em Java, com foco em quando usar cada um.',
    description:
      'O tema, escrito pelo admin. Vai para o prompt estruturado junto do nome ' +
      'da insígnia e do nível',
  })
  @IsString()
  @Transform(trim)
  @Length(10, 2000)
  prompt: string;

  @ApiProperty({ enum: DIFFICULTIES, example: 'medium' })
  @IsIn(DIFFICULTIES)
  difficulty: Difficulty;

  @ApiProperty({
    example: 30,
    minimum: 1,
    maximum: 30,
    description:
      'Quantas gerar nesta chamada. O teto é 30 (ponto Q.3) — a tela oferece ' +
      '10, 20 ou 30, e chamadas separadas por nível',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  count: number;
}

/**
 * O rascunho que volta para a tela.
 *
 * **Nao tem `id` porque nada foi gravado** (decisao 9). O que existe aqui e uma
 * proposta; o que a torna questao e o admin clicar em salvar, e ai o `bulk`
 * devolve os `QuestionDto` de verdade, com id.
 */
export class GeneratedQuestionsDto {
  @ApiProperty({
    type: [Object],
    description:
      'As questões propostas, **não persistidas**. Cada uma com `difficulty`, ' +
      '`question`, `alternatives` e `correctIndex`',
  })
  questions: {
    difficulty: Difficulty;
    question: string;
    alternatives: string[];
    correctIndex: number;
  }[];

  @ApiProperty({
    example: 3,
    description:
      'Quantas o modelo devolveu fora do formato e foram descartadas em ' +
      'silêncio. **A tela precisa mostrar este número**: sem ele, um rascunho ' +
      'de 7 quando se pediu 10 parece um limite do produto em vez de um modelo ' +
      'que errou o formato',
  })
  discarded: number;
}

/** O que o `bulk` devolve: as questoes gravadas, agora com id. */
export class BulkCreatedQuestionsDto {
  @ApiProperty({ type: [QuestionDto] })
  questions: QuestionDto[];
}
