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
      xpAwarded: 28,
      hintsUsed: 2,
      mainCode: null,
      resultImageUrl: null,
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
      hintsUsed: 0,
      mainCode: null,
      resultImageUrl: null,
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
      hintsUsed: 0,
      mainCode: null,
      resultImageUrl: null,
      completedAt: AGORA,
    });

    expect(
      trainingCompletionConverter.fromFirestore(snapshot(gravado)).xpAwarded,
    ).toBe(80);
  });

  /**
   * **`hintsUsed` é o que explica, numa auditoria, por que um desafio de 30
   * pagou 27** (spec 025).
   *
   * Ele fica ao lado do `xpAwarded`, gravado "como pago" e nunca recalculado,
   * e pelo mesmo motivo: o admin pode editar as dicas do desafio depois, e
   * recontar a partir do treinamento de hoje acusaria uma divergência que nunca
   * existiu. **Ele não é a trava de repetição** -- quem impede o segundo
   * pagamento continua sendo o `ALREADY_EXISTS` do caminho `{uid}__{trainingId}`.
   */
  it('guarda quantas dicas foram cobradas naquela conclusão', () => {
    const gravado = trainingCompletionConverter.toFirestore({
      id: 'uid-123__trn-001',
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 27,
      hintsUsed: 3,
      mainCode: null,
      resultImageUrl: null,
      completedAt: AGORA,
    });

    expect(gravado.hintsUsed).toBe(3);
    expect(
      trainingCompletionConverter.fromFirestore(snapshot(gravado)).hintsUsed,
    ).toBe(3);
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

  /**
   * Toda conclusão anterior à spec 025 é um documento sem `hintsUsed`, e
   * nenhum script vai passar nelas. Zero é a verdade sobre elas: naquele dia
   * não havia dica a revelar, e o desafio pagou o prêmio cheio.
   */
  it('lê `hintsUsed` como zero numa conclusão anterior à spec 025', () => {
    const documento = {
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 30,
      completedAt: Timestamp.fromDate(AGORA),
    };

    const lido = trainingCompletionConverter.fromFirestore(snapshot(documento));

    expect(lido.hintsUsed).toBe(0);
    expect(Number.isNaN(lido.hintsUsed)).toBe(false);
  });

  /**
   * Mesma historia na spec 027: toda conclusao anterior a ela e um documento sem
   * `mainCode` e sem `resultImageUrl`, e `null` e a verdade
   * sobre ela -- naquele dia nao havia o que enviar.
   */
  it('le a submissao como nula numa conclusao anterior a spec 027', () => {
    const documento = {
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 30,
      hintsUsed: 2,
      completedAt: Timestamp.fromDate(AGORA),
    };

    const lido = trainingCompletionConverter.fromFirestore(snapshot(documento));

    expect(lido.mainCode).toBeNull();
    expect(lido.resultImageUrl).toBeNull();
  });

  it('guarda a submissao como ela chegou', () => {
    const gravado = trainingCompletionConverter.toFirestore({
      id: 'uid-123__trn-001',
      uid: 'uid-123',
      trainingId: 'trn-001',
      xpAwarded: 30,
      hintsUsed: 0,
      mainCode: 'public static void main(String[] args) {}',
      resultImageUrl: 'https://s/b/trainings/uid-123/trn-001?v=1',
      completedAt: AGORA,
    });

    const lido = trainingCompletionConverter.fromFirestore(snapshot(gravado));

    expect(lido.mainCode).toBe('public static void main(String[] args) {}');
    expect(lido.resultImageUrl).toBe(
      'https://s/b/trainings/uid-123/trn-001?v=1',
    );
  });
});
