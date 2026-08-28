import { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { badgeVideoConverter } from './badge-video.entity';

/**
 * Um snapshot com a superficie exata que o converter usa: `id` e `data()`.
 *
 * O `unknown` no meio e deliberado -- os documentos deste teste sao **os que
 * estao no banco hoje**, e nenhum deles tem os campos que as specs 010, 017 e
 * 021 acrescentaram. Tipar a entrada como `BadgeVideoDocument` faria o
 * compilador exigir justamente os campos cuja ausencia e o objeto do teste.
 */
function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'logica__dQw4w9WgXcQ',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

const AGORA = Timestamp.fromDate(new Date('2026-08-28T12:00:00.000Z'));

/** O documento minimo que existe no banco desde a spec 009. */
function documentoBase(extra: Record<string, unknown> = {}) {
  return {
    badgeId: 'logica',
    title: 'Variáveis na prática',
    description: null,
    youtubeId: 'dQw4w9WgXcQ',
    questionId: null,
    question: null,
    devTierFree: false,
    order: 0,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...extra,
  };
}

describe('badgeVideoConverter', () => {
  /**
   * O teste-trava do fallback de `tab` (spec 021, decisao 2).
   *
   * **O que ele impede:** sem `tab: data.tab ?? data.kind ?? 'aula'`, todo
   * documento gravado antes desta spec le `tab: undefined`, e
   * `where('tab', '==', 'aula')` devolve **lista vazia com 200**. A trilha
   * inteira some sem ninguem ter apagado nada, e sem erro em log nenhum.
   *
   * E a terceira vez que este repositorio encontra esta armadilha: `kind` na
   * spec 010 e `devTierFree` na spec 009 foram as duas primeiras. Nenhum
   * documento no banco ganha o campo -- o fallback e a migracao.
   */
  describe('o documento anterior a spec 021, que nao tem `tab`', () => {
    it('le `tab` igual ao `kind`, que e a lista em que ele ja estava', () => {
      const video = badgeVideoConverter.fromFirestore(
        snapshot(documentoBase({ kind: 'resposta' })),
      );

      expect(video.kind).toBe('resposta');
      expect(video.tab).toBe('resposta');
    });

    // O video anterior a spec 010 nao tem nem `kind` nem `tab`, e sao todos os
    // videos publicados antes daquela spec: os dois defaults se somam.
    it('le `tab: aula` quando nao tem nem `kind`', () => {
      const video = badgeVideoConverter.fromFirestore(
        snapshot(documentoBase()),
      );

      expect(video.kind).toBe('aula');
      expect(video.tab).toBe('aula');
    });
  });

  /**
   * O caso que a spec inteira existe para permitir. Um teste que so cobrisse os
   * fallbacks deixaria alguem "simplificar" o converter para `tab = kind` e
   * matar a funcionalidade sem quebrar nada.
   */
  it('respeita o `tab` gravado quando ele diverge do `kind`', () => {
    const video = badgeVideoConverter.fromFirestore(
      snapshot(documentoBase({ kind: 'resposta', tab: 'aula' })),
    );

    expect(video.kind).toBe('resposta');
    expect(video.tab).toBe('aula');
  });

  it('grava `tab` no documento, e nao o deriva na escrita', () => {
    const documento = badgeVideoConverter.toFirestore({
      id: 'logica__dQw4w9WgXcQ',
      badgeId: 'logica',
      title: 'Herança e composição, na prática',
      description: null,
      youtubeId: 'dQw4w9WgXcQ',
      kind: 'resposta',
      tab: 'aula',
      questionId: '2026-08-09__uid-1',
      question: null,
      devTierFree: false,
      order: 3,
      createdAt: new Date('2026-08-28T12:00:00.000Z'),
      updatedAt: new Date('2026-08-28T12:00:00.000Z'),
    });

    expect(documento.kind).toBe('resposta');
    expect(documento.tab).toBe('aula');
  });
});
