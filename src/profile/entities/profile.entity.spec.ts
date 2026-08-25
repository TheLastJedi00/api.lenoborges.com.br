import { Timestamp } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { profileConverter } from './profile.entity';

function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'uid-123',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

const antigo = {
  name: 'Leno',
  phone: '47999990000',
  bio: 'bio',
  grade: 3,
  createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
  updatedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
};

describe('profileConverter.fromFirestore', () => {
  /**
   * O pior fallback de perder desta spec. Documento antigo não tem
   * `emailOptOut` — e são todos, no dia em que a spec 014 sobe. Sem o
   * `?? false`, o valor chega `undefined`, a base inteira parece descadastrada,
   * e o primeiro disparo sai para zero pessoa sem erro nenhum.
   */
  it('teste-trava: documento sem emailOptOut e lido como false', () => {
    const profile = profileConverter.fromFirestore(snapshot(antigo));

    expect(profile.emailOptOut).toBe(false);
    expect(profile.emailOptOutReason).toBeNull();
    expect(profile.emailOptOutAt).toBeNull();
  });

  it('documento com o opt-out gravado devolve o motivo e a data', () => {
    const quando = new Date('2026-08-25T12:00:00.000Z');
    const profile = profileConverter.fromFirestore(
      snapshot({
        ...antigo,
        emailOptOut: true,
        emailOptOutReason: 'bounce',
        emailOptOutAt: Timestamp.fromDate(quando),
      }),
    );

    expect(profile.emailOptOut).toBe(true);
    expect(profile.emailOptOutReason).toBe('bounce');
    expect(profile.emailOptOutAt).toEqual(quando);
  });

  it('as redes e o tier tambem tem fallback, pelo mesmo motivo', () => {
    const profile = profileConverter.fromFirestore(snapshot(antigo));

    expect(profile.tier).toBe('dev-tier');
    expect(profile.linkedin).toBeNull();
    expect(profile.instagram).toBeNull();
    expect(profile.completedAt).toBeNull();
  });
});
