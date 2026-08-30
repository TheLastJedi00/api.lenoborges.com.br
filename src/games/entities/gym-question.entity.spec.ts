import { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { GymQuestion, gymQuestionConverter } from './gym-question.entity';

const AGORA = new Date('2026-08-30T12:00:00.000Z');

function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'q-1',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

function questao(extra: Partial<GymQuestion> = {}): GymQuestion {
  return {
    id: 'q-1',
    badgeId: 'logica',
    difficulty: 'easy',
    question: 'O que um laço `for` controla?',
    alternatives: [
      'A repetição de um bloco',
      'A alocação de memória',
      'A ordem dos parâmetros',
      'O tipo de uma variável',
    ],
    correctIndex: 0,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...extra,
  };
}

describe('gymQuestionConverter', () => {
  it('faz round-trip sem perder campo', () => {
    const original = questao();
    const gravado = gymQuestionConverter.toFirestore(
      original,
    ) as unknown as Record<string, unknown>;

    const lido = gymQuestionConverter.fromFirestore(snapshot(gravado));

    expect(lido).toEqual(original);
  });

  it('preserva as quatro alternativas na ordem', () => {
    // A ordem e a resposta: `correctIndex` aponta para uma posicao desta lista,
    // e um converter que reordenasse -- ou que deduplicasse -- moveria a certa
    // sem mover o indice.
    const original = questao();
    const gravado = gymQuestionConverter.toFirestore(
      original,
    ) as unknown as Record<string, unknown>;

    expect(gravado.alternatives).toEqual(original.alternatives);
    expect(
      gymQuestionConverter.fromFirestore(snapshot(gravado)).alternatives,
    ).toHaveLength(4);
  });

  it('preserva correctIndex como numero, inclusive o zero', () => {
    // Zero e o indice mais comum e o mais facil de perder: um `|| 0` em algum
    // lugar do caminho o transformaria em zero por acidente, e um `?? null`
    // numa refatoracao futura o apagaria. Este teste existe para o zero.
    for (const correctIndex of [0, 1, 2, 3]) {
      const gravado = gymQuestionConverter.toFirestore(
        questao({ correctIndex }),
      ) as unknown as Record<string, unknown>;

      expect(gravado.correctIndex).toBe(correctIndex);
      expect(
        gymQuestionConverter.fromFirestore(snapshot(gravado)).correctIndex,
      ).toBe(correctIndex);
    }
  });

  it('grava as datas como Timestamp e as le como Date', () => {
    const gravado = gymQuestionConverter.toFirestore(
      questao(),
    ) as unknown as Record<string, unknown>;

    expect(gravado.createdAt).toBeInstanceOf(Timestamp);
    expect(
      gymQuestionConverter.fromFirestore(snapshot(gravado)).createdAt,
    ).toEqual(AGORA);
  });

  it('le o id do caminho, e nao do corpo do documento', () => {
    // O ID e automatico nesta colecao (nao carrega garantia nenhuma), entao ele
    // so existe no caminho. Duplica-lo dentro do documento criaria duas fontes
    // para o mesmo fato.
    const gravado = gymQuestionConverter.toFirestore(
      questao(),
    ) as unknown as Record<string, unknown>;

    expect(gravado.id).toBeUndefined();
    expect(gymQuestionConverter.fromFirestore(snapshot(gravado)).id).toBe(
      'q-1',
    );
  });
});
