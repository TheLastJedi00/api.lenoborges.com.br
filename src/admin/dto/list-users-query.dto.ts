import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TIER_IDS } from '../../billing/billing.tiers';
import type { TierId } from '../../billing/billing.tiers';
import { GRADE_MAX, GRADE_MIN } from '../../profile/entities/profile.entity';

/** Quantos membros a página traz por padrão, e o teto dela. */
export const LIST_USERS_DEFAULT_LIMIT = 50;
export const LIST_USERS_MAX_LIMIT = 200;

/** Os dois estados de onboarding, do ponto de vista de quem procura. */
export type OnboardingFilter = 'pendente' | 'concluido';
export const ONBOARDING_FILTERS: readonly OnboardingFilter[] = [
  'pendente',
  'concluido',
];

/**
 * O recorte da lista de membros (spec 015, decisões 5 a 7).
 *
 * **`tiers`, `gradeMin` e `gradeMax` têm a mesma forma do `AudienceFilterDto` da
 * spec 014, e os dois precisam continuar iguais.** O ganho não é estético: o
 * admin recorta aqui, olha quem são as pessoas, e digita o mesmo recorte na tela
 * de e-mails com a certeza de que os dois números batem. Dois DTOs divergiriam
 * na primeira vez que um dos dois ganhasse um campo, e o sintoma seria o admin
 * deixar de confiar nos dois números.
 *
 * Não são a mesma classe porque a herança apontaria para o lado errado: a lista
 * tem `q`, `onboarding`, `limit` e `offset`, que a audiência não pode ganhar de
 * carona — `POST /admin/emails` com um campo `uids` ou um `q` seria exatamente a
 * porta que a decisão 7 recusa.
 *
 * **Ausência de filtro significa TODOS**, e nunca ninguém, nos quatro campos.
 */
export class ListUsersQueryDto {
  @ApiPropertyOptional({
    example: 'borges',
    maxLength: 100,
    description:
      'Trecho de nome ou e-mail, comparado sem acento e sem caixa. É contains, ' +
      'e não prefixo: quem procura pelo sobrenome digita o meio da string',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }): unknown =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  q?: string;

  @ApiPropertyOptional({
    enum: ONBOARDING_FILTERS as unknown as string[],
    description:
      '`pendente` é quem criou conta e não terminou — inclusive quem não tem ' +
      'documento de perfil nenhum. Ausente traz os dois',
  })
  @IsOptional()
  @IsIn(ONBOARDING_FILTERS)
  onboarding?: OnboardingFilter;

  @ApiPropertyOptional({
    isArray: true,
    enum: TIER_IDS as unknown as string[],
    description: 'Tiers que entram. Ausente significa TODOS os tiers',
  })
  @IsOptional()
  // Query aceita `tiers=a&tiers=b` e `tiers=a`. O Express entrega string no
  // segundo caso, e sem isto a validacao de array recusaria um filtro de um
  // tier so — que e o caso mais comum de todos.
  @Transform(({ value }): unknown => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Array.isArray(value) ? value : [value];
  })
  @IsArray()
  @IsIn(TIER_IDS, { each: true, message: 'Tier inválido' })
  tiers?: TierId[];

  @ApiPropertyOptional({
    minimum: GRADE_MIN,
    maximum: GRADE_MAX,
    description: 'Insígnia mínima, inclusiva. Ausente significa sem piso',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  gradeMin?: number;

  @ApiPropertyOptional({
    minimum: GRADE_MIN,
    maximum: GRADE_MAX,
    description: 'Insígnia máxima, inclusiva. Ausente significa sem teto',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  gradeMax?: number;

  @ApiPropertyOptional({
    default: LIST_USERS_DEFAULT_LIMIT,
    maximum: LIST_USERS_MAX_LIMIT,
    description:
      'Tamanho da página. Acima do teto é fixado no teto, sem erro: é ' +
      'paginação, e não pedido de dados',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    default: 0,
    description: 'Deslocamento DENTRO do recorte, e não dentro da base',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
