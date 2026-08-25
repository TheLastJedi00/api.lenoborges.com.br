import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIER_IDS } from '../../billing/billing.tiers';
import type { TierId } from '../../billing/billing.tiers';
import { GRADE_MAX, GRADE_MIN } from '../../profile/entities/profile.entity';

/**
 * O recorte da audiência (spec 014, decisão 12).
 *
 * **Ausência dos dois filtros significa todos os membros**, e nunca ninguém.
 *
 * > **Não existe filtro de pagamento aqui, e não é esquecimento.** Não há
 * > pagamento no produto: não existe gateway, `tier` é campo que o admin edita à
 * > mão, e não existe estado de assinatura — nem em dia, nem atrasado, nem
 * > cancelado (ver `BillingService.resolveCurrentTier`). Inventar um
 * > `paymentStatus` agora criaria um segundo dono da verdade de acesso ao lado
 * > do `tier`, alimentado à mão pela mesma pessoa, e os dois divergiriam na
 * > primeira semana movimentada. Quando existir cobrança de verdade, o filtro
 * > entra — e entra **derivado do gateway, não digitado**. Esta é a linha que
 * > alguém vai querer "só adicionar".
 */
export class AudienceFilterDto {
  @ApiPropertyOptional({
    example: ['ultra-dev-tier', 'master-dev-tier'],
    isArray: true,
    enum: TIER_IDS as unknown as string[],
    description: 'Tiers que recebem. Ausente significa TODOS os tiers',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe pelo menos um tier, ou omita o campo' })
  @IsIn(TIER_IDS, {
    each: true,
    message: 'Tier inválido',
  })
  tiers?: TierId[];

  @ApiPropertyOptional({
    example: 1,
    minimum: GRADE_MIN,
    maximum: GRADE_MAX,
    description: 'Insígnia mínima, inclusiva. Ausente significa sem piso',
  })
  @IsOptional()
  @IsInt({ message: 'A insígnia mínima deve ser um número inteiro' })
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  gradeMin?: number;

  @ApiPropertyOptional({
    example: 8,
    minimum: GRADE_MIN,
    maximum: GRADE_MAX,
    description: 'Insígnia máxima, inclusiva. Ausente significa sem teto',
  })
  @IsOptional()
  @IsInt({ message: 'A insígnia máxima deve ser um número inteiro' })
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  gradeMax?: number;
}
