import { ApiProperty } from '@nestjs/swagger';

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
