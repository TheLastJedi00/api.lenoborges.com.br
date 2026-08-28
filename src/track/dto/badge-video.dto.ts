import { ApiProperty } from '@nestjs/swagger';

/**
 * A pergunta que o vídeo responde, como ela estava **quando o vídeo foi
 * publicado**.
 */
export class AnsweredQuestionDto {
  @ApiProperty({ example: '2026-08-09__9b1deb4d' })
  id: string;

  @ApiProperty({
    example: 'Quando usar herança em vez de composição?',
    description:
      'O título de quando o vídeo foi publicado. **Pode divergir do texto atual ' +
      'da pergunta no Mural**, e isso é o comportamento certo: o vídeo respondeu ' +
      'o que foi perguntado',
  })
  title: string;

  @ApiProperty({
    example: 'Ana Prado',
    description: 'Nome de quem perguntou, na data em que perguntou',
  })
  authorName: string;

  @ApiProperty({
    example: '2026-08-09T18:00:00.000Z',
    description:
      'Quando a **pergunta** foi feita, em ISO 8601. Não é a data de publicação ' +
      'do vídeo — o balão diz quando alguém teve a dúvida',
  })
  askedAt: string;
}

export class BadgeVideoDto {
  @ApiProperty({ example: 'logica__dQw4w9WgXcQ' })
  id: string;

  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({ example: 'Variáveis na prática' })
  title: string;

  @ApiProperty({ nullable: true, example: null })
  description: string | null;

  @ApiProperty({
    example: 'dQw4w9WgXcQ',
    description: 'Só o ID. Quem monta a URL do player é a tela',
  })
  youtubeId: string;

  @ApiProperty({
    example: 'aula',
    enum: ['aula', 'resposta'],
    description:
      'A aba da insígnia. Aula se assiste em ordem; resposta se consulta por assunto',
  })
  kind: 'aula' | 'resposta';

  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'A pergunta do Mural que originou a resposta. Nulo em toda aula',
  })
  questionId: string | null;

  @ApiProperty({
    type: AnsweredQuestionDto,
    nullable: true,
    description:
      'A pergunta que este vídeo responde, **fotografada na publicação**. É o ' +
      'que a tela usa para desenhar o balão acima do player, sem uma segunda ' +
      'leitura. Não substitui `questionId`: o id serve para navegar, a foto ' +
      'serve para desenhar. Nulo em toda aula e em **todo vídeo anterior à spec ' +
      '017** — quem consome desenha o balão quando ele existe',
  })
  question: AnsweredQuestionDto | null;

  @ApiProperty({
    example: 'paisagem',
    enum: ['paisagem', 'retrato'],
    description:
      'A proporção do player: `paisagem` é 16:9, `retrato` é 9:16 (Short). ' +
      '**Derivada no servidor e não gravada**, como a `phase` do Mural — o ' +
      'cliente consome e **não recalcula**. Derivar de `kind` no front faria a ' +
      'regra existir em três lugares, e faria o conserto de uma resposta gravada ' +
      'em paisagem exigir deploy de front',
  })
  orientation: 'paisagem' | 'retrato';

  @ApiProperty({
    example: false,
    description:
      'Livre para todos, mesmo numa insígnia adiantada. **A precedência é ' +
      'total**: quando existir gate de conteúdo, ele começa por esta flag e sai',
  })
  devTierFree: boolean;

  @ApiProperty({
    example: 0,
    description: 'Posição dentro da insígnia E da aba, de 0 a n-1',
  })
  order: number;

  @ApiProperty({
    example: false,
    description:
      'Se **quem pediu esta lista** já marcou o vídeo como assistido (spec ' +
      '019). É o único campo desta resposta que muda de membro para membro — a ' +
      'lista deixou de ser igual para todo mundo, e um cache colocado sem olhar ' +
      'isto serve o check de uma pessoa para outra sem falhar em nada. Vídeo ' +
      'sem registro é `false`: não existe "não sei"',
  })
  watched: boolean;
}

export class BadgeVideoListDto {
  @ApiProperty({ example: 'logica' })
  badgeId: string;

  @ApiProperty({
    type: [BadgeVideoDto],
    description:
      'Já na ordem. Lista VAZIA é resposta legítima e vem com 200: insígnia sem ' +
      'conteúdo é o estado normal do produto, não um erro',
  })
  videos: BadgeVideoDto[];
}
