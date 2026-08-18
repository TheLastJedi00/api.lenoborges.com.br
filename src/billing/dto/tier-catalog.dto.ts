import { ApiProperty } from '@nestjs/swagger';
import { TierDto } from './tier.dto';
import type { TierId } from '../billing.tiers';

/**
 * Resposta de `GET /billing/tiers`.
 *
 * **Este endpoint exige sessão, e a razão é a única que justifica servir dado
 * estático por rede:** o preço não pode sair no bundle público. Se o número está
 * no JavaScript que qualquer visitante baixa, ele não saiu da landing — só saiu
 * da tela, e continua a dois cliques no DevTools. Ver a decisão 1 da spec 009.
 */
export class TierCatalogDto {
  @ApiProperty({
    type: [TierDto],
    description: 'Os quatro tiers, em ordem de degrau',
  })
  tiers: TierDto[];

  @ApiProperty({
    example: 'dev-tier',
    description:
      'O tier do usuário autenticado. Hoje é sempre dev-tier, porque não existe ' +
      'cobrança — o campo existe para haver um lugar só que responda essa pergunta',
  })
  currentTierId: TierId;
}
