import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DIFFICULTIES } from '../../games/games.constants';
import type { Difficulty } from '../../games/games.constants';

/** Tira o espaço das pontas sem estourar quando o valor não é texto. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * O pedido de geração de treinamentos por IA (spec 025, decisão 3).
 *
 * Molde exato do `GenerateQuestionsDto`, inclusive no `difficulty`: é
 * `@IsIn(DIFFICULTIES)` e não string livre, reusando `DIFFICULTIES` de
 * `games.constants`. **É um import de constante, e não de módulo** -- não abre
 * volta de DI nenhuma entre a Arena e o GYM.
 */
export class GenerateTrainingsDto {
  @ApiProperty({
    example:
      'Desafios sobre laços de repetição em Java, partindo de um problema do dia a dia.',
    description:
      'O tema, escrito pelo admin. Vai para o prompt estruturado junto do ' +
      'nome da insígnia e do nível',
  })
  @IsString()
  @Transform(trim)
  @Length(10, 2000)
  prompt: string;

  @ApiProperty({ enum: DIFFICULTIES, example: 'medium' })
  @IsIn(DIFFICULTIES)
  difficulty: Difficulty;

  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 10,
    description:
      'Quantos gerar nesta chamada. **O teto é 10, e não 30 como nas ' +
      'questões**: um treinamento tem enunciado, objetivo e uma lista de ' +
      'dicas, e trinta deles não cabem numa resposta só',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  count: number;
}

/** Um treinamento proposto pelo modelo. **Sem `id`: nada foi gravado.** */
export class GeneratedTrainingDto {
  @ApiProperty({ example: 'A idade que o sistema não aceita' })
  title: string;

  @ApiProperty({
    example:
      'Um cadastro aceita qualquer número no campo idade, inclusive negativos.',
    description: 'O cenário do desafio',
  })
  description: string;

  @ApiProperty({
    example: 'O cadastro recusa idade fora da faixa e avisa o usuário.',
    description: 'O resultado esperado',
  })
  objective: string;

  @ApiProperty({
    type: [String],
    example: [
      'Precisamos de uma variável inteira para guardar a idade.',
      'Antes de aceitar, compare o valor com a faixa que faz sentido.',
    ],
    description:
      'As dicas de raciocínio, na ordem. **Não é a solução escrita**: o ' +
      'prompt pede o caminho do pensamento, e o membro paga 1 XP por cada uma ' +
      'que abrir',
  })
  hints: string[];
}

/**
 * O rascunho que volta para a tela.
 *
 * **Nada foi gravado** (decisão 3). O que existe aqui é uma proposta; o que a
 * torna treinamento é o admin clicar em salvar, e aí a página dispara um
 * `POST /admin/badges/:badgeId/trainings` por rascunho aprovado -- **não existe
 * rota de `bulk` para treinamentos, e esta spec não cria uma**.
 */
export class GeneratedTrainingsDto {
  @ApiProperty({
    type: [GeneratedTrainingDto],
    description: 'Os treinamentos propostos, **não persistidos**',
  })
  trainings: GeneratedTrainingDto[];

  @ApiProperty({
    example: 2,
    description:
      'Quantos o modelo devolveu fora do formato e foram descartados em ' +
      'silêncio. **A tela precisa mostrar este número**: sem ele, um rascunho ' +
      'de 3 quando se pediu 5 parece um limite do produto em vez de um modelo ' +
      'que errou o formato',
  })
  discarded: number;
}
