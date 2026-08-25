import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteAccountDto {
  @ApiProperty({
    example: 'senha-atual',
    description:
      'Senha atual. A exclusão é imediata e não tem desfazer, então a ' +
      'confirmação é a credencial, não um clique',
  })
  @IsString({ message: 'Senha deve ser um texto' })
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  @MaxLength(200, { message: 'Senha deve ter no máximo 200 caracteres' })
  password: string;
}
