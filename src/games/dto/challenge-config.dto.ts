import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { QuestionCountsDto } from './question.dto';

export class SetChallengeConfigDto {
  @ApiProperty({
    example: 200,
    minimum: 0,
    description:
      'XP mínimo para participar do desafio desta insígnia. Zero é sem ' +
      'exigência, e é o padrão — a primeira insígnia costuma exigir 0, e só as ' +
      'últimas ganham exigência',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  // Teto largo e proposital: ele existe para impedir o erro de digitacao que
  // deixa uma insignia inalcancavel para sempre -- um zero a mais num campo
  // numerico e a forma mais barata de tirar um desafio do ar sem apagar nada.
  @Max(1_000_000)
  requiredXp: number;
}

/**
 * O que a tela do admin mostra no bloco de configuracao.
 *
 * **A contagem vem junto de proposito** (decisao 11): o XP minimo sem o banco de
 * questoes embaixo nao tem contexto, e a tela desenha os dois no mesmo bloco.
 * Duas rotas seriam duas requisicoes para pintar um cabecalho.
 */
export class ChallengeConfigDto {
  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({ example: 200 })
  requiredXp: number;

  @ApiProperty({
    example: true,
    description:
      'Se o admin já salvou uma configuração. Distingue "não configurado" de ' +
      '"configurado com zero" — os dois valem zero, e a tela precisa da ' +
      'diferença para não mostrar uma data de 1970',
  })
  configured: boolean;

  @ApiProperty({ type: QuestionCountsDto })
  counts: QuestionCountsDto;
}
