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
   * Qual e o tier desta pessoa. **A unica funcao que responde isso.**
   *
   * A spec 009 criou este metodo com corpo vazio e um TODO; a spec 010 lhe deu
   * corpo, porque o Mural precisou do primeiro portao de acesso do produto e um
   * portao precisa saber quem paga.
   *
   * Hoje a resposta e `profile.tier`, um campo que o admin edita a mao. Isso
   * parece atalho e nao e: **e o desenho fiel do produto de hoje**. Nao existe
   * checkout -- o upgrade acontece por conversa e o pagamento por fora --, e se
   * o pagamento e manual, o direito de acesso tambem e. Fingir o contrario
   * exigiria inventar um estado de assinatura que ninguem alimenta.
   *
   * TODO(assinatura): quando existir gateway, e por dentro daqui que ele entra,
   * sem nenhum chamador precisar saber.
   *
   * Duas coisas que a implementacao futura nao pode fazer:
   *
   * - **Derivar o tier de `grade`**, nem `grade` do tier. `grade` e conquista,
   *   tier e acesso, e o teste `nao deriva o tier a partir do grade` existe para
   *   denunciar quem os misturar.
   * - **Zerar `grade` no cancelamento.** Insignia e conquista, nao aluguel: quem
   *   cancelou com seis insignias continua com seis, e o que ele perde e o
   *   avanco. Ver as decisoes 5c e 5d da spec 008.
   */
  resolveCurrentTier(profile: Profile): TierId {
    return profile.tier;
  }
}
