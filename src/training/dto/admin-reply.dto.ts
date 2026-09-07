import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AdminReplyDto {
  @ApiProperty({
    example: 'Rode npm ci antes: o lock estava velho.',
    description:
      'A resposta do admin, gravada **no próprio comentário**. Uma por ' +
      'comentário: responder de novo sobrescreve a anterior',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 2000)
  content: string;
}
