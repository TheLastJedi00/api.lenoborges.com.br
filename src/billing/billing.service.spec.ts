import { BillingService } from './billing.service';
import { Profile } from '../profile/entities/profile.entity';

const perfil: Profile = {
  id: 'uid-1',
  name: 'Membro',
  phone: '47999990000',
  bio: 'bio',
  grade: 0,
  completedAt: new Date(),
  waitlistEntryId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BillingService', () => {
  const service = new BillingService();

  it('devolve os quatro tiers na ordem dos degraus', () => {
    const catalogo = service.getCatalog(perfil);

    expect(catalogo.tiers.map((tier) => tier.id)).toEqual([
      'dev-tier',
      'great-dev-tier',
      'ultra-dev-tier',
      'master-dev-tier',
    ]);
  });

  // Centavos, e nao decimal. O teste fixa o formato porque trocar por 260.0 nao
  // quebraria nada visivelmente ate a primeira soma.
  it('serve o preco em centavos', () => {
    const catalogo = service.getCatalog(perfil);
    const master = catalogo.tiers.find((tier) => tier.id === 'master-dev-tier');

    expect(master?.price).toBe(26000);
    expect(master?.priceLabel).toBe('R$ 260,00');
  });

  // Os tiers sao cumulativos, e a tela precisa poder dizer isso sem inventar
  // texto. Cada tier pago abre declarando o anterior.
  it('abre cada tier pago com "Tudo do" tier anterior', () => {
    const catalogo = service.getCatalog(perfil);
    const pagos = catalogo.tiers.filter((tier) => tier.price > 0);

    for (const tier of pagos) {
      expect(tier.perks[0]).toMatch(/^Tudo do /);
    }
  });

  /**
   * Este teste quebra -- de proposito -- no dia em que alguem implementar
   * assinatura sem ler a decisao 4 da spec 009. Enquanto nao existe cobranca,
   * todo mundo e Dev Tier, e a resposta sai de um lugar so.
   */
  it('resolve todo perfil como dev-tier enquanto nao existe cobranca', () => {
    expect(service.resolveCurrentTier(perfil)).toBe('dev-tier');
    expect(service.resolveCurrentTier({ ...perfil, grade: 13 })).toBe(
      'dev-tier',
    );
  });

  // O portao e o tier, nunca o grade. Se um dia o resolveCurrentTier passar a
  // olhar o progresso, este teste e o que denuncia.
  it('nao deriva o tier a partir do grade', () => {
    const iniciante = service.resolveCurrentTier({ ...perfil, grade: 0 });
    const campeao = service.resolveCurrentTier({ ...perfil, grade: 12 });

    expect(iniciante).toBe(campeao);
  });
});
