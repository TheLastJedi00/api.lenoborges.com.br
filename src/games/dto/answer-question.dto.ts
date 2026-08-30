import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AnswerQuestionDto {
  @ApiProperty({
    example: 3,
    minimum: 0,
    maximum: 9,
    description: 'Qual das dez questões da rodada, de 0 a 9',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9)
  questionIndex: number;

  @ApiProperty({
    example: 2,
    minimum: 0,
    maximum: 3,
    description: 'A alternativa escolhida, na ordem em que a tela as recebeu',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  chosenIndex: number;

  @ApiProperty({
    example: 4200,
    minimum: 0,
    description:
      'Milissegundos que o front cronometrou entre pintar a questão e o ' +
      'toque na alternativa. **É conferido, não confiado**: entra no cálculo ' +
      'só se estiver entre 0 e o tempo do servidor mais 2s, e o XP usa o menor ' +
      'dos dois — a latência de rede não é tempo de pensar, e não pode custar XP',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Teto de um dia. Nao e uma regra de negocio -- a regra e o `+2s` sobre o
  // tempo do servidor, la no `resolveElapsedSeconds` -- e sim um limite de
  // sanidade: um numero absurdo aqui viraria `Infinity` em alguma conta futura.
  @Max(86_400_000)
  clientElapsedMs: number;
}

/**
 * O que o membro recebe depois de responder.
 *
 * **`correctAlternativeIndex` sai aqui e so aqui**, depois de a resposta ter
 * sido dada: e o que a tela usa para pintar a certa de verde. Manda-lo junto das
 * questoes seria entregar o gabarito antes da prova.
 */
export class AnswerResultDto {
  @ApiProperty({ example: true })
  correct: boolean;

  @ApiProperty({
    example: 2,
    description:
      'Qual era a alternativa certa **nesta rodada**, já na ordem embaralhada ' +
      'que a tela recebeu. Só aparece depois de responder',
  })
  correctAlternativeIndex: number;

  @ApiProperty({
    example: 47,
    description:
      'O XP desta questão. Zero quando erra e zero no modo treino. **O front ' +
      'não calcula este número e não conhece a fórmula**',
  })
  xpAwarded: number;

  @ApiProperty({
    example: false,
    description: 'Se a rodada é treino — nenhuma questão paga XP (decisão 21)',
  })
  replay: boolean;

  @ApiProperty({
    example: 340,
    description:
      'O XP total do membro **depois** desta resposta. A tela grava este ' +
      'número no AuthStore; somar `xp + xpAwarded` localmente erra no replay e ' +
      'em toda resposta errada',
  })
  totalXp: number;

  @ApiProperty({
    required: false,
    example: true,
    description: 'Se esta era a décima questão e a rodada acabou',
  })
  roundComplete?: boolean;

  @ApiProperty({
    required: false,
    example: 8,
    description: 'Acertos na rodada',
  })
  score?: number;

  @ApiProperty({ required: false, example: true })
  roundPassed?: boolean;

  @ApiProperty({
    required: false,
    example: false,
    description: 'Se as três rodadas fecharam e a insígnia foi conquistada',
  })
  badgeUnlocked?: boolean;

  @ApiProperty({
    required: false,
    example: 2,
    description:
      'O `grade` do membro depois da conquista. Pode não ter subido: o `grade` ' +
      'só avança em ordem (decisão 13)',
  })
  grade?: number;

  @ApiProperty({
    required: false,
    example: 2,
    description: 'A próxima rodada, quando esta foi aprovada e havia próxima',
  })
  nextRound?: number;
}
