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
    example: 1,
    description: 'Grau atual do membro (1 a 33)',
  })
  grade: number;

  @ApiProperty({
    example: true,
    description: 'Indica se o onboarding foi concluído',
  })
  profileCompleted: boolean;
}
