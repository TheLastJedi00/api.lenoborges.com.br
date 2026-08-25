import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { normalizeEmail } from '../../common/normalize';

export class ChangeEmailDto {
  @ApiProperty({
    example: 'novo@email.com',
    description:
      'Novo endereço de acesso. A confirmação vai para ele, e a troca só ' +
      'acontece quando o link for clicado',
  })
  @IsString({ message: 'E-mail deve ser um texto' })
  @IsNotEmpty({ message: 'E-mail é obrigatório' })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail({}, { message: 'E-mail inválido' })
  newEmail: string;

  @ApiProperty({
    example: 'senha-atual',
    description:
      'Senha atual. **Quem prova ser o dono é a senha, não o token**: um ID ' +
      'token roubado vale uma hora, e uma hora basta para trocar o e-mail de ' +
      'acesso e tomar a conta para sempre',
  })
  @IsString({ message: 'Senha deve ser um texto' })
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  @MaxLength(200, { message: 'Senha deve ter no máximo 200 caracteres' })
  password: string;
}
