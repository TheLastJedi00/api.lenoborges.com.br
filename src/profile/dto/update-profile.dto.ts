import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @IsString({ message: 'Nome deve ser um texto' })
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MinLength(2, { message: 'Nome deve ter no mínimo 2 caracteres' })
  @MaxLength(120, { message: 'Nome deve ter no máximo 120 caracteres' })
  name: string;

  @IsString({ message: 'Telefone deve ser um texto' })
  @IsNotEmpty({ message: 'Telefone é obrigatório' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve ter 10 ou 11 dígitos',
  })
  phone: string;

  @IsString({ message: 'Bio deve ser um texto' })
  @IsNotEmpty({ message: 'Bio é obrigatória' })
  @MinLength(10, { message: 'Bio deve ter no mínimo 10 caracteres' })
  @MaxLength(500, { message: 'Bio deve ter no máximo 500 caracteres' })
  bio: string;
}
