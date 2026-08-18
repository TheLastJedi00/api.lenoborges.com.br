import { ApiProperty } from '@nestjs/swagger';
import type { TierId } from '../billing.tiers';

export class TierDto {
  @ApiProperty({
    example: 'master-dev-tier',
    enum: ['dev-tier', 'great-dev-tier', 'ultra-dev-tier', 'master-dev-tier'],
    description: 'Identificador do tier, estável e usado como chave no front',
  })
  id: TierId;

  @ApiProperty({ example: 'Master Dev Tier' })
  name: string;

  @ApiProperty({
    example: 26000,
    description:
      'Preço em CENTAVOS. Valor monetário em decimal não sobrevive a uma soma; ' +
      'a formatação é responsabilidade da tela',
  })
  price: number;

  @ApiProperty({
    example: 'R$ 260,00',
    description:
      'Rótulo pronto, para o front usar como fallback — nunca como fonte. ' +
      'Dois formatadores discordando mostram R$ 260 num lugar e R$ 260,00 no outro',
  })
  priceLabel: string;

  @ApiProperty({ example: 'mensal', enum: ['mensal', 'gratuito'] })
  period: 'mensal' | 'gratuito';

  @ApiProperty({
    example:
      'Tudo do Ultra Dev Tier, mais duas aulas de inglês por mês voltadas para entrevista técnica.',
  })
  summary: string;

  @ApiProperty({
    type: [String],
    description:
      'O que o tier entrega. Os tiers são cumulativos, então todo tier pago ' +
      'abre com "Tudo do <tier anterior>"',
  })
  perks: string[];
}
