import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTrainingCommentDto {
  @ApiProperty({
    example: 'Travei no passo 3, o teste não roda aqui.',
    description:
      'O texto do comentário. **Só Great Tier ou superior escreve** — o Dev ' +
      'Tier lê a conversa e recebe um 403 com o caminho para assinar',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 2000)
  content: string;
}
