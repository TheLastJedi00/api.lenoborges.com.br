import { ApiProperty } from '@nestjs/swagger';

export class TrainingDto {
  @ApiProperty({ example: 'A1b2C3d4E5' })
  id: string;

  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({ example: 'Refatore o laço em três funções' })
  title: string;

  @ApiProperty({ example: 'Um exercício de leitura antes de escrever.' })
  description: string;

  @ApiProperty({
    type: [String],
    example: ['Clone o repositório', 'Rode os testes'],
    description: 'Os passos, na ordem. A tela desenha um `<ol>`',
  })
  steps: string[];

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'A URL crua do vídeo de apoio, ou nulo quando não há anexo',
  })
  videoUrl: string | null;

  @ApiProperty({
    example: 30,
    description:
      'Quanto este desafio paga, uma vez só. Vem do documento, e não de uma ' +
      'constante do servidor: o admin pode ter escrito outro valor',
  })
  xpAmount: number;

  @ApiProperty({ example: 0, description: 'A posição na insígnia, de 0 a n-1' })
  position: number;

  @ApiProperty({
    example: false,
    description:
      'Se **quem pediu esta lista** já concluiu o desafio. É o único campo que ' +
      'muda de membro para membro — um cache colocado sem olhar isto serve o ' +
      'check de uma pessoa para outra sem falhar em nada. Desafio sem registro ' +
      'é `false`: não existe "não sei"',
  })
  completed: boolean;
}

export class TrainingListDto {
  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({
    type: [TrainingDto],
    description:
      'Já na ordem. Lista VAZIA é resposta legítima e vem com 200: insígnia ' +
      'sem desafio é o estado normal do produto, não um erro',
  })
  trainings: TrainingDto[];
}

export class TrainingCommentReplyDto {
  @ApiProperty({ example: 'Rode npm ci antes: o lock estava velho.' })
  content: string;

  @ApiProperty({ example: 'Leno', description: 'Quem respondeu, na data' })
  authorName: string;

  @ApiProperty({ example: '2026-09-02T09:00:00.000Z' })
  repliedAt: string;
}

export class TrainingCommentDto {
  @ApiProperty({ example: 'K1l2M3n4O5' })
  id: string;

  @ApiProperty({ example: 'A1b2C3d4E5' })
  trainingId: string;

  @ApiProperty({
    example: 'Ana',
    description:
      'O nome de quem escreveu, **fotografado na criação**. Uma troca de nome ' +
      'no perfil não reescreve comentário antigo, e isso é o certo: é o nome ' +
      'de quem escreveu naquele dia',
  })
  authorName: string;

  @ApiProperty({ example: 'Travei no passo 3, o teste não roda aqui.' })
  content: string;

  @ApiProperty({
    type: TrainingCommentReplyDto,
    nullable: true,
    description:
      'A resposta do admin, ou nulo enquanto ninguém respondeu — que é o ' +
      'estado da grande maioria. **É campo do comentário, e não documento à ' +
      'parte**: a lista é plana, e uma coleção de respostas custaria uma ' +
      'leitura por comentário para devolver a mesma informação',
  })
  adminReply: TrainingCommentReplyDto | null;

  @ApiProperty({ example: '2026-09-01T12:00:00.000Z' })
  createdAt: string;
}

export class TrainingCommentListDto {
  @ApiProperty({
    type: [TrainingCommentDto],
    description: 'Mais recentes primeiro',
  })
  comments: TrainingCommentDto[];

  @ApiProperty({
    nullable: true,
    example: 'K1l2M3n4O5',
    description:
      'O cursor da próxima página, ou nulo quando acabou. É o id do último ' +
      'comentário desta página — opaco para quem consome, que é o que um ' +
      'cursor deve ser',
  })
  nextCursor: string | null;
}

export class TrainingCompletionDto {
  @ApiProperty({ example: 'A1b2C3d4E5' })
  trainingId: string;

  @ApiProperty({
    example: true,
    description: 'Sempre true depois desta chamada',
  })
  completed: boolean;

  @ApiProperty({
    example: 30,
    description:
      'Quanto **esta chamada** pagou. Zero quando o desafio já estava ' +
      'concluído: a rota é idempotente e responde 200 nas duas vezes',
  })
  xpAwarded: number;

  @ApiProperty({
    example: 130,
    description:
      'O XP total do membro depois da escrita, lido do perfil. **É o valor do ' +
      'servidor**, e a tela pinta este número em vez de somar localmente',
  })
  xp: number;
}

/**
 * Uma linha do painel centralizado do admin.
 *
 * Carrega o comentário **e** o mínimo do treinamento para a tela dizer de onde
 * ele veio. Sem isso o admin leria "travei no passo 3" sem saber de qual
 * desafio, e teria que abrir a trilha para descobrir.
 */
export class AdminTrainingCommentDto extends TrainingCommentDto {
  @ApiProperty({
    nullable: true,
    example: 'Refatore o laço em três funções',
    description:
      'O título do treinamento comentado. **Nulo quando o desafio já foi ' +
      'excluído** — o que não deveria acontecer, já que a exclusão apaga os ' +
      'comentários, e é exatamente por isso que vale saber',
  })
  trainingTitle: string | null;

  @ApiProperty({ nullable: true, example: 'logica' })
  badgeId: string | null;
}

export class AdminTrainingCommentListDto {
  @ApiProperty({ type: [AdminTrainingCommentDto] })
  comments: AdminTrainingCommentDto[];
}
