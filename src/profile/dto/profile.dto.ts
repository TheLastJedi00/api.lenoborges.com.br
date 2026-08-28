import type { TierId } from '../../billing/billing.tiers';
import { ApiProperty } from '@nestjs/swagger';
import { LegalDocumentSummaryDto } from '../../legal/dto/legal-document-summary.dto';

/** O aceite vigente de um documento, como o front o le (spec 018). */
export class LegalAcceptanceDto {
  @ApiProperty({ example: '2026-08-27' })
  version: string;

  @ApiProperty({ example: '2026-03-12T14:02:00.000Z' })
  acceptedAt: string;
}

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
    example: 'https://www.linkedin.com/in/fulano',
    nullable: true,
    description: 'URL completa do perfil no LinkedIn, ou nulo',
  })
  linkedin: string | null;

  @ApiProperty({
    example: 'https://www.instagram.com/fulano',
    nullable: true,
    description: 'URL completa do perfil no Instagram, ou nulo',
  })
  instagram: string | null;

  @ApiProperty({
    example: false,
    description:
      'Se este membro saiu da lista de e-mails. O front desenha o interruptor ' +
      'de Meu Perfil com este valor — sem ele, ele nasceria sempre ligado',
  })
  emailOptOut: boolean;

  @ApiProperty({
    example: 'dev-tier',
    enum: ['dev-tier', 'great-dev-tier', 'ultra-dev-tier', 'master-dev-tier'],
    description:
      'Tier de acesso. É acesso, não conquista: não se deriva de grade nem o contrário',
  })
  tier: TierId;

  @ApiProperty({
    type: [LegalDocumentSummaryDto],
    description:
      'Documentos legais vigentes que este membro ainda não aceitou (spec ' +
      '018). Lista vazia é o estado normal. É a MESMA lista que o corpo do 428 ' +
      'carrega, calculada pelo mesmo LegalService.pendingFor — os dois canais ' +
      'precisam dizer a mesma coisa, sempre. Este avisa na entrada, e o 428 ' +
      'pega a versão publicada enquanto a pessoa estava com a aba aberta',
  })
  pendingLegal: LegalDocumentSummaryDto[];

  @ApiProperty({
    example: 340,
    description:
      'Pontos de experiência: 10 por vídeo assistido, uma vez por vídeo, para ' +
      'sempre (spec 019). **Desmarcar não devolve XP.** Vem calculado daqui — a ' +
      'tela não multiplica nada, porque remarcar um vídeo não paga XP e uma ' +
      'soma no cliente erraria em todo vídeo remarcado',
  })
  xp: number;

  @ApiProperty({
    example: false,
    description:
      'Se as redes sociais deste membro aparecem no cartão que os outros abrem. ' +
      '**Nasce desligado.** É o que deixa o interruptor de Meu Perfil abrir já ' +
      'na posição certa — sem este campo a tela chuta, e chuta ligado',
  })
  socialLinksPublic: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/LegalAcceptanceDto' },
    description:
      'O aceite vigente de cada documento, por id. É o que a seção Contratos ' +
      'de Meu Perfil mostra',
  })
  legalAcceptances: Record<string, LegalAcceptanceDto>;
}
