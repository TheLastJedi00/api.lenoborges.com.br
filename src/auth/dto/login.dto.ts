import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'fulano@email.com',
    description: 'E-mail cadastrado',
  })
  @IsEmail({}, { message: 'E-mail inválido' })
  @IsNotEmpty({ message: 'E-mail é obrigatório' })
  email: string;

  @ApiProperty({
    example: 'SenhaForte123',
    description: 'Senha da conta',
  })
  @IsString({ message: 'Senha é obrigatória' })
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  password: string;
}
