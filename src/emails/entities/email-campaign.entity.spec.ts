import { Timestamp } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { emailCampaignConverter } from './email-campaign.entity';

function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'camp-1',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

/** Uma campanha como a spec 014 gravava, antes de existir e-mail direto. */
const antiga = {
  kind: 'manual',
  subject: 'Assunto',
  body: 'Corpo',
  ctaLabel: null,
  ctaUrl: null,
  filters: { tiers: null, gradeMin: null, gradeMax: null },
  status: 'concluida',
  audienceCount: 42,
  sentCount: 42,
  failedCount: 0,
  cursorUid: null,
  createdBy: 'uid-admin',
  createdAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
  finishedAt: null,
  error: null,
};

describe('emailCampaignConverter.fromFirestore', () => {
  /**
   * **O teste-trava desta fase, e o `?? null` mais perigoso do converter.**
   *
   * Documento antigo não tem `recipientUid` — e são todos, no dia em que a spec
   * 015 sobe. `undefined` ali faz uma campanha direta parecer campanha de base:
   * o curto-circuito da decisão 11 lê `recipientUid` para decidir se monta um
   * destinatário ou a audiência inteira, e `undefined` cai no lado errado. O
   * sintoma seria retomar um recado pessoal e mandá-lo para toda a comunidade.
   */
  it('teste-trava: campanha antiga sem recipientUid é lida como null', () => {
    const campanha = emailCampaignConverter.fromFirestore(snapshot(antiga));

    expect(campanha.recipientUid).toBeNull();
    expect(campanha.recipientLabel).toBeNull();
  });

  it('campanha direta devolve o destinatário e o rótulo gravados', () => {
    const campanha = emailCampaignConverter.fromFirestore(
      snapshot({
        ...antiga,
        kind: 'direto',
        recipientUid: 'uid-membro',
        recipientLabel: 'Leno Borges',
      }),
    );

    expect(campanha.kind).toBe('direto');
    expect(campanha.recipientUid).toBe('uid-membro');
    expect(campanha.recipientLabel).toBe('Leno Borges');
  });
});

describe('emailCampaignConverter.toFirestore', () => {
  it('grava os dois campos novos, inclusive quando são nulos', () => {
    const documento = emailCampaignConverter.toFirestore({
      id: 'camp-1',
      kind: 'manual',
      subject: 'Assunto',
      body: 'Corpo',
      ctaLabel: null,
      ctaUrl: null,
      filters: { tiers: null, gradeMin: null, gradeMax: null },
      recipientUid: null,
      recipientLabel: null,
      status: 'enviando',
      audienceCount: 1,
      sentCount: 0,
      failedCount: 0,
      cursorUid: null,
      createdBy: 'uid-admin',
      createdAt: new Date('2026-08-25T12:00:00.000Z'),
      finishedAt: null,
      error: null,
    });

    // Gravar `undefined` seria o mesmo defeito visto do outro lado: o documento
    // sairia sem o campo, e a proxima leitura cairia no fallback.
    expect(documento).toHaveProperty('recipientUid', null);
    expect(documento).toHaveProperty('recipientLabel', null);
  });
});
