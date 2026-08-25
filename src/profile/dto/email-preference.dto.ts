import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EmailPreferenceDto {
  @ApiProperty({
    example: true,
    description:
      'Se o membro quer receber os e-mails da Liga Dev. `false` descadastra, ' +
      '`true` religa — o mesmo campo que o link do rodapé escreve',
  })
  @IsBoolean({ message: 'Informe verdadeiro ou falso' })
  receber: boolean;
}
