import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { isInstagramUrl, isLinkedinUrl } from '../../common/social-url';

/**
 * String vazia vira `null`: quem apagou o campo quer que ele suma, nao que
 * fique `''`. Ausente continua ausente -- e a diferenca entre "nao mencionei" e
 * "quero apagar", e ela e decidida aqui, uma vez, para os dois campos.
 */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

// `@IsOptional()` ja pula a validacao quando o valor e `null` ou `undefined`,
// entao estas duas classes so veem string de verdade.
@ValidatorConstraint({ name: 'linkedinUrl' })
class LinkedinUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isLinkedinUrl(value);
  }

  defaultMessage(): string {
    return 'LinkedIn deve ser uma URL https do linkedin.com';
  }
}

@ValidatorConstraint({ name: 'instagramUrl' })
class InstagramUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isInstagramUrl(value);
  }

  defaultMessage(): string {
    return 'Instagram deve ser uma URL https do instagram.com';
  }
}

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

  @ApiPropertyOptional({
    example: 'https://www.linkedin.com/in/fulano',
    nullable: true,
    maxLength: 200,
    description:
      'URL completa do perfil no LinkedIn. String vazia remove o valor; campo ' +
      'ausente deixa o valor guardado intacto',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @MaxLength(200, { message: 'LinkedIn deve ter no máximo 200 caracteres' })
  @Validate(LinkedinUrlConstraint)
  linkedin?: string | null;

  @ApiPropertyOptional({
    example: 'https://www.instagram.com/fulano',
    nullable: true,
    maxLength: 200,
    description:
      'URL completa do perfil no Instagram. String vazia remove o valor; campo ' +
      'ausente deixa o valor guardado intacto',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @MaxLength(200, { message: 'Instagram deve ter no máximo 200 caracteres' })
  @Validate(InstagramUrlConstraint)
  instagram?: string | null;
}
