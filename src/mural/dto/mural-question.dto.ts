import { ApiProperty } from '@nestjs/swagger';
import type { MuralPhase } from '../mural-phase';

export class MuralQuestionDto {
  @ApiProperty({ example: '2026-08-16__9b1deb4d3b7d' })
  id: string;

  @ApiProperty({
    example: '2026-08-16',
    description: 'Domingo que abre a semana',
  })
  weekId: string;

  @ApiProperty({
    example: 'coleta',
    enum: ['coleta', 'votacao', 'encerrada'],
    description:
      'Onde a pergunta está. Derivada na leitura, e **pode ter sido adiantada ' +
      'pelo admin**: é o maior entre a conta do relógio e o piso da promoção. ' +
      'Uma pergunta com o `weekId` da semana corrente pode legitimamente estar ' +
      'em votação',
  })
  phase: MuralPhase;

  @ApiProperty({
    nullable: true,
    example: null,
    enum: ['votacao', 'encerrada'],
    description:
      'O adiantamento do admin, quando houve. **Não é redundante com `phase` e ' +
      'não se deriva dela**: `phase` diz onde a pergunta está, `promotedTo` diz ' +
      'se ela chegou lá pelo relógio ou pela mão do admin. Sem o segundo, a ' +
      'tela não tem como escrever "adiantada" nem como saber qual botão de ' +
      'promoção ainda faz sentido — e derivar isso no front seria reimplementar ' +
      'a regra do lado errado',
  })
  promotedTo: 'votacao' | 'encerrada' | null;

  @ApiProperty({ example: 'poo' })
  badgeId: string;

  @ApiProperty({
    example: 'Leno',
    description: 'Nome de quando a pergunta foi feita — é denormalizado',
  })
  authorName: string;

  @ApiProperty({
    example: 'Como saber quando usar herança em vez de composição?',
  })
  title: string;

  @ApiProperty({ nullable: true, example: null })
  body: string | null;

  @ApiProperty({ example: 12 })
  voteCount: number;

  @ApiProperty({
    example: false,
    description: 'Se o usuário autenticado já votou nesta pergunta',
  })
  hasVoted: boolean;

  @ApiProperty({
    example: false,
    description: 'Se a pergunta é do próprio usuário',
  })
  isMine: boolean;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Vídeo de resposta, quando a pergunta venceu e foi respondida',
  })
  answerVideoId: string | null;

  @ApiProperty({
    example: '2026-08-09T18:00:00.000Z',
    description:
      'Quando a pergunta foi feita, em ISO 8601. **Não é o `weekId`**: aquele é ' +
      'o domingo que abre a semana, e a pergunta pode ter nascido na quinta. ' +
      'Saiu na spec 017, para o painel poder mostrar a data no balão de pré-' +
      'visualização com o mesmo texto que o aluno vai ler na trilha',
  })
  createdAt: string;
}
