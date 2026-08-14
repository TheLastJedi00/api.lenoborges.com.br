import { IsEmail, IsNotEmpty } from 'class-validator';

export class SignupDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  @IsNotEmpty({ message: 'E-mail é obrigatório' })
  email: string;

  @IsEmail({}, { message: 'Confirmação de e-mail inválida' })
  @IsNotEmpty({ message: 'Confirmação de e-mail é obrigatória' })
  emailConfirmation: string;
}
