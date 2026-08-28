import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetWatchedDto {
  @ApiProperty({
    example: true,
    description:
      'O estado desejado do check. `true` marca, `false` desmarca. **A rota é ' +
      'idempotente**: marcar o que já está marcado responde 200 sem pagar XP de ' +
      'novo, e desmarcar não devolve o XP já pago',
  })
  // **Obrigatorio, e sem valor padrao.** Um corpo vazio que caisse em `true`
  // faria um PUT malformado marcar o video, e o unico jeito de perceber seria
  // pelo XP subindo sozinho.
  @IsBoolean({ message: 'watched deve ser true ou false' })
  watched: boolean;
}

export class WatchedVideoDto {
  @ApiProperty({ example: 'logica__dQw4w9WgXcQ' })
  videoId: string;

  @ApiProperty({
    example: true,
    description: 'O estado do check depois da chamada',
  })
  watched: boolean;

  @ApiProperty({
    example: 340,
    description:
      'O XP do membro **depois** desta chamada. Vem daqui para a tela não ter ' +
      'de somar nada: remarcar um vídeo não paga XP, e uma soma local acertaria ' +
      'no primeiro clique de cada vídeo e erraria em todos os seguintes',
  })
  xp: number;
}
