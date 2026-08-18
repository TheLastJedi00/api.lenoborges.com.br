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
    example: 0,
    description: 'Posição dentro da insígnia, de 0 a n-1',
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
