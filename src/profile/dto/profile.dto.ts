import type { TierId } from '../../billing/billing.tiers';
import { ApiProperty } from '@nestjs/swagger';

export class ProfileDto {
  @ApiProperty({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'Identificador único do membro (igual ao auth.users.id)',
  })
  id: string;

  @ApiProperty({
    example: 'fulano@email.com',
    description: 'E-mail do membro',
  })
  email: string;

  @ApiProperty({
    example: 'Leno Borges',
    nullable: true,
    description: 'Nome completo do membro',
  })
  name: string | null;

  @ApiProperty({
    example: '47999990000',
    nullable: true,
    description: 'Telefone com DDD',
  })
  phone: string | null;

  @ApiProperty({
    example: 'Desenvolvedor backend apaixonado por arquitetura de software.',
    nullable: true,
    description: 'Biografia do membro',
  })
  bio: string | null;

  @ApiProperty({
    example: 3,
    description:
      'Etapas concluídas na trilha da Liga Dev: 0 a 8 são insígnias, 9 a 12 a ' +
      'Elite Four, 13 a Battle Frontier (spec 008)',
  })
  grade: number;

  @ApiProperty({
    example: true,
    description: 'Indica se o onboarding foi concluído',
  })
  profileCompleted: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: ['admin'],
    description:
      'Papel do usuário, vindo da custom claim do Firebase Auth. Nulo para o ' +
      'membro comum. O front usa para decidir se desenha a Administração — ' +
      'quem impede o acesso é o AdminGuard, não a ausência do botão',
  })
  role: 'admin' | null;

  @ApiProperty({
    example: 'dev-tier',
    enum: ['dev-tier', 'great-dev-tier', 'ultra-dev-tier', 'master-dev-tier'],
    description:
      'Tier de acesso. É acesso, não conquista: não se deriva de grade nem o contrário',
  })
  tier: TierId;
}
