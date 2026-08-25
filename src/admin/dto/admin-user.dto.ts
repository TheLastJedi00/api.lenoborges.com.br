import { ApiProperty } from '@nestjs/swagger';

/**
 * Uma linha da lista de usuários.
 *
 * Junta duas fontes: o **Firebase Auth**, que sabe quem existe, e o `profiles`,
 * que sabe quem a pessoa é. Os campos de perfil chegam nulos para quem se
 * cadastrou e não terminou o onboarding — e essa pessoa **não pode sumir da
 * lista**, porque é justamente a que o admin mais precisa ver.
 */
export class AdminUserDto {
  @ApiProperty({ example: '9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d' })
  id: string;

  @ApiProperty({ example: 'membro@email.com', nullable: true })
  email: string | null;

  @ApiProperty({ example: false })
  emailVerified: boolean;

  @ApiProperty({ example: false })
  disabled: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: ['admin'],
    description: 'Custom claim do Firebase Auth',
  })
  role: 'admin' | null;

  @ApiProperty({ example: '2026-08-18T09:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ nullable: true, example: '2026-08-18T10:30:00.000Z' })
  lastSignInAt: string | null;

  @ApiProperty({ nullable: true, example: 'Leno Borges' })
  name: string | null;

  @ApiProperty({ nullable: true, example: '47999990000' })
  phone: string | null;

  @ApiProperty({
    nullable: true,
    example: 3,
    description: 'Nulo quando o usuário ainda não tem documento de perfil',
  })
  grade: number | null;

  @ApiProperty({
    example: false,
    description: 'Falso também para quem não tem perfil nenhum',
  })
  profileCompleted: boolean;

  @ApiProperty({
    example: false,
    description:
      'Se este membro saiu da lista de e-mails. Sem este campo, "não chegou o ' +
      'e-mail para o fulano" vira investigação sem pista',
  })
  emailOptOut: boolean;
}
