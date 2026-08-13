import { IsString, Length, IsEmail, Equals, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWaitlistEntryDto {
  @ApiProperty({
    example: 'João Silva',
    description: 'Nome do usuário (2 a 120 caracteres)',
  })
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    example: '(11) 99999-8888',
    description: 'Telefone com DDD (10 ou 11 dígitos)',
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @Matches(/^[0-9]{10,11}$/, { message: 'phone must contain 10 or 11 digits' })
  phone: string;

  @ApiProperty({ example: 'joao@email.com', description: 'E-mail do usuário' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: true,
    description: 'Consentimento obrigatório para uso dos dados',
  })
  @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}
