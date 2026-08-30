import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DIFFICULTIES } from '../games.constants';
import type { Difficulty } from '../games.constants';
import { trim, trimEach } from './trim';

export class CreateQuestionDto {
  @ApiProperty({
    example: 'easy',
    enum: DIFFICULTIES,
    description:
      'O nível da questão, e também a rodada em que ela pode cair: fácil é a ' +
      'rodada 1, média a 2 e difícil a 3',
  })
  @IsIn(DIFFICULTIES)
  difficulty: Difficulty;

  @ApiProperty({
    example: 'O que um laço `for` controla?',
    description:
      'O enunciado. Texto puro, com Markdown aceito para blocos de código — ' +
      'imagem é outra spec',
  })
  @IsString()
  @Transform(trim)
  @Length(10, 1000)
  question: string;

  @ApiProperty({
    example: [
      'A repetição de um bloco',
      'A alocação de memória',
      'A ordem dos parâmetros',
      'O tipo de uma variável',
    ],
    description:
      'Exatamente quatro, na ordem em que foram escritas. O servidor as ' +
      'embaralha ao servir a rodada, carregando o índice correto junto',
  })
  @IsArray()
  // Quatro exatas, e as duas anotacoes juntas dizem isso melhor do que
  // `@ArrayNotEmpty()`: tres alternativas fariam a tela desenhar um botao vazio,
  // e cinco fariam a quinta ser inalcancavel -- `correctIndex` para em 3.
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  @Transform(trimEach)
  alternatives: string[];

  @ApiProperty({
    example: 0,
    minimum: 0,
    maximum: 3,
    description:
      'A **posição** da alternativa certa, nunca o texto dela. Guardar o texto ' +
      'faria a conferência virar comparação de string, e um acento reescrito ' +
      'deixaria a questão errada para sempre, em silêncio',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  correctIndex: number;
}
