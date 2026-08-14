import { ApiProperty } from '@nestjs/swagger';

export class UserInfoDto {
  @ApiProperty({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'Identificador único do usuário',
  })
  id: string;

  @ApiProperty({
    example: 'fulano@email.com',
    description: 'E-mail do usuário',
  })
  email: string;
}

export class SessionResponseDto {
  @ApiProperty({
    description: 'Access token JWT de curta duração para Authorization: Bearer',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    example: 3600,
    description: 'Tempo de expiração do access token em segundos',
  })
  expiresIn: number;

  @ApiProperty({
    type: () => UserInfoDto,
    description: 'Informações básicas do usuário autenticado',
  })
  user: UserInfoDto;

  @ApiProperty({
    example: true,
    description:
      'Indica se o usuário já completou o formulário de onboarding/perfil',
  })
  profileCompleted: boolean;

  @ApiProperty({
    example: 1,
    description: 'Grau atual do membro na Seita Dev (1 a 33)',
  })
  grade: number;
}
