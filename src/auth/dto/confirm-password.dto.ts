import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Corpo de `POST /auth/password`.
 *
 * Herdeiro do `SetPasswordDto` que a decisao 3 da spec 007 matou, e volta com
 * outro nome e outra credencial: **o segredo agora e o `oobCode` do Firebase**,
 * nao um token proprio desta API.
 *
 * **Nao ha campo `mode`** -- ver o comentario do `CheckOobDto`.
 */
export class ConfirmPasswordDto {
  @ApiProperty({
    example: 'C0d1gO_qu3_v31o_n0_l1nk',
    description: 'Código de uso único vindo do link do e-mail',
  })
  @IsString({ message: 'Código deve ser um texto' })
  @IsNotEmpty({ message: 'Código é obrigatório' })
  @MaxLength(2000, { message: 'Código inválido' })
  oobCode: string;

  @ApiProperty({
    example: 'senha-nova-forte',
    minLength: 8,
    description: 'Senha que o membro passa a usar para entrar',
  })
  @IsString({ message: 'Senha deve ser um texto' })
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  // **O minimo real e a politica do console** (Authentication > Settings >
  // Password policy), nao este decorator: o Identity Toolkit recusa a senha
  // fraca mesmo que ele a aceite, e a API traduz a recusa (decisao 6). O
  // MinLength daqui e cortesia, para dar erro melhor antes da viagem -- e a
  // mesma linha que o ChangePasswordDto ja carrega pelo mesmo motivo.
  @MinLength(8, { message: 'Senha deve ter no mínimo 8 caracteres' })
  @MaxLength(200, { message: 'Senha deve ter no máximo 200 caracteres' })
  newPassword: string;
}

/** Resposta de `POST /auth/password/check` e de `POST /auth/email-action`. */
export class OobEmailResponseDto {
  @ApiProperty({
    example: 'fulano@email.com',
    description:
      'E-mail dono do link. Devolvê-lo não é o oráculo que o signup evita: ' +
      'aqui o requisitante forneceu o oobCode, que só chegou por uma caixa de entrada.',
  })
  email: string;
}
