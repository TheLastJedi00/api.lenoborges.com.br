import { FirebaseService } from '../auth/firebase.service';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { TrainingCompletionRepository } from './training-completion.repository';

describe('TrainingCompletionRepository', () => {
  let firestore: FakeFirestore;
  let repository: TrainingCompletionRepository;

  beforeEach(() => {
    firestore = new FakeFirestore();
    repository = new TrainingCompletionRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  async function concluir(uid: string, trainingId: string, xpAwarded = 30) {
    const batch = firestore.batch();
    repository.create(batch as never, {
      uid,
      trainingId,
      xpAwarded,
      now: new Date('2026-09-01T12:00:00.000Z'),
    });
    await batch.commit();
  }

  describe('create', () => {
    it('grava no caminho composto, que é onde mora a unicidade', async () => {
      await concluir('ana', 'trn-1');

      expect(firestore.raw('training_completions/ana__trn-1')).toBeDefined();
    });

    /**
     * **O teste que a spec inteira existe para garantir.**
     *
     * Concluir duas vezes derruba o lote inteiro com `ALREADY_EXISTS` -- e é a
     * derrubada, e não um `if`, que impede o segundo pagamento de XP. Com
     * `jest.fn()` isto não seria testável: um mock provaria que `create` foi
     * chamado, e não que a segunda chamada falhou e levou o incremento junto.
     */
    it('recusa a segunda conclusão do mesmo desafio pelo mesmo membro', async () => {
      await concluir('ana', 'trn-1');

      await expect(concluir('ana', 'trn-1')).rejects.toMatchObject({ code: 6 });
    });

    it('não impede o mesmo membro de concluir outro desafio', async () => {
      await concluir('ana', 'trn-1');

      await expect(concluir('ana', 'trn-2')).resolves.toBeUndefined();
    });

    it('não impede outro membro de concluir o mesmo desafio', async () => {
      await concluir('ana', 'trn-1');

      await expect(concluir('beto', 'trn-1')).resolves.toBeUndefined();
    });

    it('guarda o XP que foi pago, e não o padrão', async () => {
      await concluir('ana', 'trn-1', 80);

      const { entry } = await repository.findById('ana', 'trn-1');

      expect(entry?.xpAwarded).toBe(80);
    });
  });

  describe('findById', () => {
    it('devolve `{ found: false, entry: null }` quando não concluiu', async () => {
      expect(await repository.findById('ana', 'trn-1')).toEqual({
        found: false,
        entry: null,
      });
    });
  });

  describe('findCompletedIds', () => {
    it('não vai ao banco quando a insígnia não tem treinamento', async () => {
      expect(await repository.findCompletedIds('ana', [])).toEqual(new Set());
    });

    it('devolve só os que aquele membro concluiu', async () => {
      await concluir('ana', 'trn-1');
      await concluir('beto', 'trn-2');

      const concluidos = await repository.findCompletedIds('ana', [
        'trn-1',
        'trn-2',
        'trn-3',
      ]);

      expect(concluidos).toEqual(new Set(['trn-1']));
    });

    /**
     * Treinamento sem documento é `false`, e não "não sei".
     *
     * A tela desenha um check ou não desenha; um terceiro estado viraria um
     * ícone de dúvida que ninguém desenhou e que a decisão nunca previu.
     */
    it('trata o desafio nunca tocado como não concluído', async () => {
      expect(await repository.findCompletedIds('ana', ['trn-9'])).toEqual(
        new Set(),
      );
    });
  });

  describe('a limpeza', () => {
    it('apaga as conclusões de quem pediu para ser esquecido, e só as dele', async () => {
      await concluir('ana', 'trn-1');
      await concluir('ana', 'trn-2');
      await concluir('beto', 'trn-1');

      await repository.removeAll('ana');

      expect(
        await repository.findCompletedIds('ana', ['trn-1', 'trn-2']),
      ).toEqual(new Set());
      expect(await repository.findCompletedIds('beto', ['trn-1'])).toEqual(
        new Set(['trn-1']),
      );
    });

    it('apaga as conclusões do treinamento excluído, e só as dele', async () => {
      await concluir('ana', 'trn-1');
      await concluir('beto', 'trn-1');
      await concluir('ana', 'trn-2');

      await repository.removeAllByTraining('trn-1');

      expect(
        await repository.findCompletedIds('ana', ['trn-1', 'trn-2']),
      ).toEqual(new Set(['trn-2']));
      expect(await repository.findCompletedIds('beto', ['trn-1'])).toEqual(
        new Set(),
      );
    });

    it('não faz nada quando não há o que apagar', async () => {
      await expect(repository.removeAll('ninguem')).resolves.toBeUndefined();
    });
  });
});
