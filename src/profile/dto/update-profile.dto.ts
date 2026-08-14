import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({
    example: 'Leno Borges',
    minLength: 2,
    maxLength: 120,
    description: 'Nome completo do membro',
  })
  @IsString({ message: 'Nome deve ser um texto' })
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  @MaxLength(120, { message: 'Nome deve ter no máximo 120 caracteres' })
  name: string;

  @ApiProperty({
    example: '47999990000',
    description:
      'Número de telefone com DDD (10 ou 11 dígitos, apenas números)',
  })
  @IsString({ message: 'Telefone deve ser um texto' })
  @IsNotEmpty({ message: 'Telefone é obrigatório' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve ter 10 ou 11 dígitos',
  })
  phone: string;

  @ApiProperty({
    example: 'Desenvolvedor backend apaixonado por arquitetura de software.',
    minLength: 10,
    maxLength: 500,
    description: 'Biografia e apresentação pessoal do membro',
  })
  @IsString({ message: 'Bio deve ser um texto' })
  @IsNotEmpty({ message: 'Bio é obrigatória' })
  @MinLength(10, { message: 'Bio deve ter no mínimo 10 caracteres' })
  @MaxLength(500, { message: 'Bio deve ter no máximo 500 caracteres' })
  bio: string;
}
