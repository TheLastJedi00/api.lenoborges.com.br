import { ApiProperty } from '@nestjs/swagger';
import { MuralQuestionDto } from './mural-question.dto';

/**
 * Como a pergunta chegou à pauta.
 *
 * `voto` é a vencedora da semana, escolhida pela comunidade. `adiantada` é a
 * que o admin empurrou para "responder logo", sem esperar o ciclo.
 *
 * Sem o rótulo, o admin não teria como distinguir a pergunta que a comunidade
 * escolheu da que ele mesmo empurrou — e as duas pedem vídeos de peso
 * diferente.
 */
export type WinnerOrigin = 'voto' | 'adiantada';

/**
 * Uma linha da pauta: o que está esperando vídeo.
 *
 * **O nome da rota continua `vencedoras` e isso é uma imprecisão consciente**
 * (spec 016, decisão 5). Renomear para `/mural/pauta` custaria uma rota nova, o
 * front inteiro apontando para ela e um período com as duas de pé — para o
 * leitor ganhar zero, já que o `origem` diz a verdade em cada linha.
 *
 * Duas listas separadas seriam duas telas, dois carregamentos e a mesma
 * pergunta em dois lugares dependendo de como ela chegou lá. O que o admin quer
 * saber é uma coisa só: o que está esperando vídeo.
 */
export class WinnerDto {
  @ApiProperty({ example: '2026-08-02' })
  weekId: string;

  @ApiProperty({
    type: () => MuralQuestionDto,
    nullable: true,
    description:
      'A mais votada da semana, ou null quando a semana passou em branco. ' +
      'Semana sem pergunta é informação honesta, não erro a esconder',
  })
  question: MuralQuestionDto | null;

  @ApiProperty({
    enum: ['voto', 'adiantada'],
    example: 'voto',
    description:
      'De onde a linha veio: `voto` é a vencedora da semana, `adiantada` é a ' +
      'que o admin empurrou para a pauta. Semana em branco entra como `voto` — ' +
      'ela é o lugar da vencedora daquela semana, e não há o que rotular',
  })
  origem: WinnerOrigin;
}
