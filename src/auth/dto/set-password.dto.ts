import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SetPasswordDto {
  @IsString({ message: 'Token é obrigatório' })
  @IsNotEmpty({ message: 'Token não pode ser vazio' })
  tokenHash: string;

  @IsString({ message: 'Senha é obrigatória' })
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password: string;

  @IsString({ message: 'Confirmação de senha é obrigatória' })
  @MinLength(8, { message: 'Confirmação de senha deve ter no mínimo 8 caracteres' })
  passwordConfirmation: string;
}
