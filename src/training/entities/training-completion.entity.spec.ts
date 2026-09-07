import { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import {
  TrainingCompletion,
  trainingCompletionConverter,
  trainingCompletionDocId,
} from './training-completion.entity';

function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'uid-123__trn-001',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

const AGORA = new Date('2026-09-01T12:00:00.000Z');

describe('trainingCompletionDocId', () => {
  /**
   * O caminho é a unicidade, e por isso ele tem um dono só.
   *
   * Um segundo lugar montando `${uid}__${trainingId}` divergiria no dia em que
   * o separador mudasse, e o sintoma seria XP pago duas vezes pelo mesmo
   * desafio -- sem erro, sem log, e visível só numa auditoria que ninguém faz.
   */
  it('junta uid e treinamento na ordem que o caminho promete', () => {
    expect(trainingCompletionDocId('uid-123', 'trn-001')).toBe(
      'uid-123__trn-001',
    );
  });
});

describe('trainingCompletionConverter', () => {
  it('devolve a mesma conclusão que gravou', () => {
    const completion: TrainingCompletion = {
      id: 'uid-123__trn-001',
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 30,
      completedAt: AGORA,
    };

    const gravado = trainingCompletionConverter.toFirestore(completion);

    expect(
      trainingCompletionConverter.fromFirestore(snapshot(gravado)),
    ).toEqual(completion);
  });

  it('grava a data como Timestamp', () => {
    const gravado = trainingCompletionConverter.toFirestore({
      id: 'uid-123__trn-001',
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 30,
      completedAt: AGORA,
    });

    expect(gravado.completedAt).toBeInstanceOf(Timestamp);
  });

  /**
   * **Guarda o que foi pago, e não o que o desafio vale hoje.**
   *
   * O admin pode editar o `xpAmount` depois. Se este campo fosse relido do
   * treinamento, uma auditoria somaria o valor de hoje sobre conclusões de
   * ontem e acusaria uma divergência que nunca existiu.
   */
  it('preserva o XP pago mesmo quando ele não é o padrão', () => {
    const gravado = trainingCompletionConverter.toFirestore({
      id: 'uid-123__trn-001',
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 80,
      completedAt: AGORA,
    });

    expect(
      trainingCompletionConverter.fromFirestore(snapshot(gravado)).xpAwarded,
    ).toBe(80);
  });

  it('lê `xpAwarded` como zero num documento sem o campo, e nunca como o padrão', () => {
    const documento = {
      uid: 'uid-123',
      trainingId: 'trn-001',
      completedAt: Timestamp.fromDate(AGORA),
    };

    expect(
      trainingCompletionConverter.fromFirestore(snapshot(documento)).xpAwarded,
    ).toBe(0);
  });
});
