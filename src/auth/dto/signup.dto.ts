import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({
    example: 'fulano@email.com',
    description: 'E-mail do cadastrante',
  })
  @IsEmail({}, { message: 'E-mail inválido' })
  @IsNotEmpty({ message: 'E-mail é obrigatório' })
  email: string;

  @ApiProperty({
    example: 'fulano@email.com',
    description:
      'Confirmação do e-mail (deve ser idêntico ao e-mail informado)',
  })
  @IsEmail({}, { message: 'Confirmação de e-mail inválida' })
  @IsNotEmpty({ message: 'Confirmação de e-mail é obrigatória' })
  emailConfirmation: string;
}

export class SignupResponseDto {
  @ApiProperty({
    example: 'confirmation_sent',
    description:
      'Status indicando envio de e-mail para confirmação/redefinição',
  })
  status: 'confirmation_sent';
}
