import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderTrainingsDto {
  @ApiProperty({
    type: [String],
    example: ['A1b2C3d4E5', 'F6g7H8i9J0'],
    description:
      'Os ids dos treinamentos da insígnia, na ordem desejada. Precisa bater ' +
      'exatamente com o conjunto que já existe: reordenar não pode criar nem ' +
      'apagar, e as três formas de errar — faltando, sobrando e repetido — são 400',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIds: string[];
}
