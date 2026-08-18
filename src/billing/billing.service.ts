import { Injectable } from '@nestjs/common';
import { TIERS, TierId } from './billing.tiers';
import { TierCatalogDto } from './dto/tier-catalog.dto';
import { Profile } from '../profile/entities/profile.entity';

@Injectable()
export class BillingService {
  getCatalog(profile: Profile): TierCatalogDto {
    return {
      tiers: TIERS.map((tier) => ({ ...tier, perks: [...tier.perks] })),
      currentTierId: this.resolveCurrentTier(profile),
    };
  }

  /**
   * Qual e o tier desta pessoa.
   *
   * **Hoje devolve `dev-tier` para todo mundo**, porque nao existe cobranca,
   * assinatura nem webhook -- ver a decisao 4 da spec 009.
   *
   * TODO(assinatura): quando existir estado de pagamento, e aqui que ele entra.
   * A funcao existe justamente para haver **um lugar so** onde essa pergunta e
   * respondida; sem ela, a resposta nasce espalhada em `if`s de controller e
   * cada um deles envelhece separado.
   *
   * Duas coisas que a implementacao futura nao pode fazer, e que sao o motivo de
   * este comentario existir:
   *
   * - **Derivar o tier de `grade`.** `grade` e conquista, tier e acesso. Sao
   *   independentes, e o teste `nao deriva o tier a partir do grade` existe para
   *   denunciar quem os misturar.
   * - **Zerar `grade` no cancelamento.** Insignia e conquista, nao aluguel. Quem
   *   cancelou com seis insignias continua com seis; o que ele perde e o avanco.
   *   Ver as decisoes 5c e 5d da spec 008.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resolveCurrentTier(profile: Profile): TierId {
    return 'dev-tier';
  }
}
