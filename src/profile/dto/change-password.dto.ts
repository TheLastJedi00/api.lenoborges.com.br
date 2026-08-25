import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'senha-atual',
    description: 'Senha atual, para reautenticar antes de trocar',
  })
  @IsString({ message: 'Senha atual deve ser um texto' })
  @IsNotEmpty({ message: 'Senha atual é obrigatória' })
  @MaxLength(200, { message: 'Senha deve ter no máximo 200 caracteres' })
  currentPassword: string;

  @ApiProperty({
    example: 'senha-nova-forte',
    minLength: 8,
    description: 'Nova senha',
  })
  @IsString({ message: 'Nova senha deve ser um texto' })
  @IsNotEmpty({ message: 'Nova senha é obrigatória' })
  // **O mínimo real é a política do console** (Authentication > Settings >
  // Password policy), e é ela quem manda: o Identity Toolkit recusa a senha
  // fraca mesmo que este decorator a aceite. O MinLength daqui é cortesia,
  // para dar erro melhor antes da viagem — quem for procurar o piso do
  // produto procura no console, não nesta linha.
  @MinLength(8, { message: 'Nova senha deve ter no mínimo 8 caracteres' })
  @MaxLength(200, { message: 'Nova senha deve ter no máximo 200 caracteres' })
  newPassword: string;
}
