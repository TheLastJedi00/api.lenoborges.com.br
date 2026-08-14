import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPasswordDto {
  @ApiProperty({
    example: '940b636f079eb15f45b8777b8bde8615368bffe29be6fc37815db828',
    description: 'Token de recuperação recebido por e-mail no link',
  })
  @IsString({ message: 'Token é obrigatório' })
  @IsNotEmpty({ message: 'Token não pode ser vazio' })
  tokenHash: string;

  @ApiProperty({
    example: 'SenhaForte123',
    minLength: 8,
    description: 'Nova senha (mínimo de 8 caracteres)',
  })
  @IsString({ message: 'Senha é obrigatória' })
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  password: string;

  @ApiProperty({
    example: 'SenhaForte123',
    minLength: 8,
    description: 'Confirmação da nova senha (deve ser idêntica à senha)',
  })
  @IsString({ message: 'Confirmação de senha é obrigatória' })
  @MinLength(8, {
    message: 'Confirmação de senha deve ter no mínimo 8 caracteres',
  })
  passwordConfirmation: string;
}
