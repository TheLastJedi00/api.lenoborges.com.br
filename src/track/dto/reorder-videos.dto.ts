import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderVideosDto {
  @ApiProperty({
    type: [String],
    example: ['logica__abc12345678', 'logica__def12345678'],
    description:
      'Os ids dos vídeos da insígnia, na ordem desejada. Precisa bater ' +
      'exatamente com o conjunto que já existe: reordenar não pode criar nem apagar',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  videoIds: string[];
}
