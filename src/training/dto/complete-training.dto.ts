import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * O corpo da conclusão de um desafio (spec 025, decisão 2).
 *
 * **`hintsUsed` é opcional e nasce zero, e isso é decisão e não descuido.** O
 * front e o back desta spec entram juntos, mas não sobem no mesmo segundo:
 * entre um deploy e outro existe uma janela em que a tela antiga manda `{}`
 * para a rota nova. Com o campo obrigatório, essa janela é um `400` em cima de
 * quem acabou de concluir um desafio -- e o membro perde o XP de um clique que
 * deu certo. Ausente significa "nenhuma dica revelada", que é exatamente o que
 * a tela antiga fazia.
 *
 * **O servidor não tem como conferir este número.** O estado das dicas
 * reveladas vive no componente, e quem quiser trapacear manda `0` e leva o
 * prêmio cheio. Isso é aceito de propósito: a alternativa seria uma escrita por
 * dica revelada, três vezes mais cara para cobrar 1 XP de quem já está com a
 * tela aberta. O que o service barra é o contrário -- um número absurdo levando
 * o cálculo para longe do desafio real --, com o teto no número de dicas.
 */
export class CompleteTrainingDto {
  @ApiProperty({
    required: false,
    example: 2,
    description:
      'Quantas dicas o membro revelou antes de concluir. Cada uma desconta ' +
      '1 XP do prêmio do desafio. **Ausente é zero**: a tela anterior à spec ' +
      '025 não manda corpo nenhum, e um 400 aqui custaria o XP de quem ' +
      'concluiu o desafio durante a janela entre os dois deploys',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  hintsUsed?: number;

  @ApiProperty({
    required: false,
    example: 'public static void main(String[] args) { ... }',
    maxLength: 20000,
    description:
      'O conteúdo da classe `main`, colado pelo membro. **Disponível para ' +
      'todos os tiers.** É a prova do que foi entregue, e não muda o XP',
  })
  @IsOptional()
  @IsString()
  // Vinte mil caracteres, e o teto nao e estetico: um documento do Firestore tem
  // limite de 1 MiB, e o campo e um Ctrl+V de classe inteira. Sem teto, a conclusao
  // falharia no `create` com um erro do Firestore que nao fala de tamanho --
  // depois de o membro ter clicado em concluir.
  @MaxLength(20000, {
    message: 'O código precisa ter no máximo 20000 caracteres.',
  })
  mainCode?: string;

  @ApiProperty({
    required: false,
    example:
      'https://storage.googleapis.com/dev-liga-dev.firebasestorage.app/trainings/uid-1/trn-1?v=1757000000000',
    maxLength: 500,
    description:
      'A foto do resultado, **exclusiva do Great Dev Tier em diante**. Precisa ' +
      'ser a URL que `POST /trainings/:trainingId/result-image` devolveu para ' +
      'este membro: qualquer outra é `400`, e o Dev Tier é `403`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resultImageUrl?: string;
}
