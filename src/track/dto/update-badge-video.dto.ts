import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Edita o que é nosso: título e descrição.
 *
 * O `youtubeId` não está aqui de propósito — ele é parte do caminho do
 * documento, e trocá-lo seria criar outro vídeo, não editar este.
 */
export class UpdateBadgeVideoDto {
  @ApiProperty({ required: false, example: 'Herança e composição, na prática' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 140)
  title?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(0, 300)
  description?: string;

  @ApiProperty({
    required: false,
    example: true,
    description:
      'Marca o vídeo como "Livre para todos". É a válvula da decisão 8 da spec ' +
      '010: sem ela, a melhor resposta da semana nasce trancada para 90% de ' +
      'quem votou nela',
  })
  @IsOptional()
  @IsBoolean()
  devTierFree?: boolean;
}
