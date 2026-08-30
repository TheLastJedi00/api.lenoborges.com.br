import { ApiProperty } from '@nestjs/swagger';

export class RankingEntryDto {
  @ApiProperty({
    example: 47,
    description:
      'A posição na lista, contando a partir de 1. Calculada na leitura, e ' +
      'não lida do cache: o cache serve à variação diária, não à ordem de agora',
  })
  position: number;

  @ApiProperty({
    example: 'uid-2',
    description:
      'O uid não é segredo aqui — é o caminho de `profiles/{uid}` e metade do ' +
      'id de uma pergunta do Mural. O que protege o dado é o `GET /members/:uid` ' +
      'devolver só o que é público (spec 019)',
  })
  uid: string;

  @ApiProperty({ example: 'LenoDev' })
  nickname: string;

  @ApiProperty({ example: 340 })
  xp: number;

  @ApiProperty({
    example: 3,
    description: 'Insígnias do GYM Battle, teto de 8',
  })
  badgeCount: number;

  @ApiProperty({
    nullable: true,
    example: 3,
    description:
      'Quantas posições subiu desde o último snapshot. Positivo é subida, ' +
      'negativo é queda, e **`null` é "ainda não sei"** — o primeiro dia do ' +
      'membro no placar. Zero diria "não mudou", que é uma afirmação diferente, ' +
      'e a tela não desenha selo nenhum quando é `null`',
  })
  positionChange: number | null;
}

export class RankingPageDto {
  @ApiProperty({ type: [RankingEntryDto] })
  entries: RankingEntryDto[];

  @ApiProperty({
    nullable: true,
    example: 47,
    description:
      'A posição do membro logado, **mesmo que ele não esteja nesta página**. ' +
      'É a linha fixa do topo da tela',
  })
  myPosition: number | null;

  @ApiProperty({
    nullable: true,
    type: RankingEntryDto,
    description: 'A linha do membro logado, ou `null` se ele não tem gamertag',
  })
  myEntry: RankingEntryDto | null;

  @ApiProperty({
    nullable: true,
    example: 'MzQwOnVpZC0y',
    description:
      'O cursor da próxima página, ou `null` no fim da lista. **Opaco**: a tela ' +
      'devolve o que recebeu, e não monta um',
  })
  nextCursor: string | null;
}
