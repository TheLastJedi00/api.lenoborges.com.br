import type { TierId } from '../../billing/billing.tiers';
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
    example: 3,
    description:
      'Etapas concluidas na trilha da Liga Dev: 0 a 8 sao insignias, 9 a 12 a ' +
      'Elite Four, 13 a Battle Frontier (spec 008)',
  })
  grade: number;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: ['admin'],
    description:
      'Papel do usuario, vindo da custom claim do Firebase Auth. Nulo para o ' +
      'membro comum. O front usa para decidir se desenha a Administracao -- ' +
      'quem impede o acesso e o AdminGuard, nao a ausencia do botao',
  })
  role: 'admin' | null;

  @ApiProperty({
    example: 'dev-tier',
    enum: ['dev-tier', 'great-dev-tier', 'ultra-dev-tier', 'master-dev-tier'],
    description:
      'Tier de acesso do membro. E ACESSO, e nao conquista: nao se deriva de ' +
      'grade nem o contrario. Diferente de role, vale na hora -- nao espera token novo',
  })
  tier: TierId;
}
