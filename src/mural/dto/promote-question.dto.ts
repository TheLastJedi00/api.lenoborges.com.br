import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Adiantar uma pergunta (spec 016, decisao 11).
 *
 * **`'coleta'` nao e valor aceito, e isso e de proposito.** A promocao e de mao
 * unica -- `coleta -> votacao -> encerrada`, e nunca o contrario --, e recusar
 * na validacao e dizer a decisao 2 no lugar mais barato: o que nao se pode
 * pedir nao precisa de 409.
 *
 * Nao e rigidez. Uma pergunta despromovida de `votacao` para `coleta` voltaria
 * a ser editavel **com votos em cima dela**, e quem votou votou naquele texto.
 * O caminho de arrependimento ja existe e e o certo:
 * `DELETE /admin/mural/perguntas/:id`, que apaga os votos junto. Remover e
 * honesto; despromover seria fingir que a semana nao aconteceu.
 */
export class PromoteQuestionDto {
  @ApiProperty({
    enum: ['votacao', 'encerrada'],
    example: 'votacao',
    description:
      'Para onde adiantar. `votacao` abre o voto agora; `encerrada` tira do ' +
      'Mural e poe na pauta. `coleta` nao e aceito: a promocao e de mao unica',
  })
  @IsIn(['votacao', 'encerrada'], {
    message: 'A promocao e de mao unica: so "votacao" ou "encerrada".',
  })
  fase: 'votacao' | 'encerrada';
}
