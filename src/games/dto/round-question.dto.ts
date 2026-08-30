import { ApiProperty } from '@nestjs/swagger';

/**
 * Uma questao como o **membro** a ve (spec 022, decisao 10).
 *
 * **Tres campos, e a ausencia do quarto e o ponto.** Nao ha `correctIndex`, nao
 * ha `correctAlternativeIndex` e nao ha `questionId`: o primeiro e a cola, o
 * segundo tambem, e o terceiro nao serve para nada do lado do cliente -- o
 * `answer` identifica a questao pelo `index` da rodada.
 *
 * **Isto nao e o `QuestionDto` com um `delete` em cima.** Sao duas classes, e
 * elas nao compartilham base nem mapeador, pela mesma razao do `PublicMemberDto`
 * da spec 019: um campo novo entra num DTO por decisao escrita, e nunca por
 * heranca.
 */
export class RoundQuestionDto {
  @ApiProperty({
    example: 0,
    description:
      'A posição na rodada, de 0 a 9. **É por ele que o `answer` identifica a ' +
      'questão** — o id da questão não sai daqui',
  })
  index: number;

  @ApiProperty({ example: 'O que um laço `for` controla?' })
  question: string;

  @ApiProperty({
    type: [String],
    description:
      'Já embaralhadas pelo servidor, e a ordem aqui é a ordem da tela. O ' +
      'índice da correta viajou junto no embaralhamento e ficou no servidor',
  })
  alternatives: string[];
}

export class StartRoundDto {
  @ApiProperty({ example: 1, enum: [1, 2, 3] })
  round: number;

  @ApiProperty({ example: 'easy', enum: ['easy', 'medium', 'hard'] })
  difficulty: string;

  @ApiProperty({
    example: false,
    description:
      'Se esta rodada é treino (decisão 21): a rodada já foi aprovada, e ' +
      'nenhuma questão paga XP. A tela mostra o selo "Modo Treino: Sem XP"',
  })
  replay: boolean;

  @ApiProperty({ type: [RoundQuestionDto] })
  questions: RoundQuestionDto[];
}
