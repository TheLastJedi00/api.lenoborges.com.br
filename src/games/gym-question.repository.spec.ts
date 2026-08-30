import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';

import {
  CreateGymQuestionData,
  GymQuestionRepository,
} from './gym-question.repository';

function makeRepository(): {
  repository: GymQuestionRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();
  const firebase = { firestore } as unknown as FirebaseService;

  return { repository: new GymQuestionRepository(firebase), firestore };
}

function data(
  extra: Partial<CreateGymQuestionData> = {},
): CreateGymQuestionData {
  return {
    badgeId: 'logica',
    difficulty: 'easy',
    question: 'O que um laço `for` controla?',
    alternatives: ['A repetição', 'A memória', 'A ordem', 'O tipo'],
    correctIndex: 0,
    ...extra,
  };
}

describe('GymQuestionRepository', () => {
  describe('create', () => {
    it('grava a questao e devolve o id gerado', async () => {
      const { repository, firestore } = makeRepository();

      const { entry } = await repository.create(data());

      expect(entry.id).toBeTruthy();
      expect(firestore.raw(`gym_questions/${entry.id}`)).toMatchObject({
        badgeId: 'logica',
        difficulty: 'easy',
        correctIndex: 0,
      });
    });

    it('carimba createdAt e updatedAt com o mesmo instante', async () => {
      const { repository } = makeRepository();

      const { entry } = await repository.create(data());

      expect(entry.createdAt).toEqual(entry.updatedAt);
    });
  });

  describe('createMany', () => {
    it('grava o lote inteiro', async () => {
      const { repository, firestore } = makeRepository();

      const { entries } = await repository.createMany([
        data(),
        data({ difficulty: 'medium' }),
        data({ difficulty: 'hard' }),
      ]);

      expect(entries).toHaveLength(3);
      expect(firestore.countUnder('gym_questions')).toBe(3);
    });

    it('aceita lote vazio sem escrever nada', async () => {
      const { repository, firestore } = makeRepository();

      const { entries } = await repository.createMany([]);

      expect(entries).toEqual([]);
      expect(firestore.countUnder('gym_questions')).toBe(0);
    });
  });

  describe('listByBadge', () => {
    it('filtra por insignia', async () => {
      const { repository } = makeRepository();
      await repository.create(data({ badgeId: 'logica' }));
      await repository.create(data({ badgeId: 'poo' }));

      const { entries } = await repository.listByBadge('logica');

      expect(entries).toHaveLength(1);
      expect(entries[0].badgeId).toBe('logica');
    });

    it('filtra por dificuldade quando ela e informada', async () => {
      const { repository } = makeRepository();
      await repository.create(data({ difficulty: 'easy' }));
      await repository.create(data({ difficulty: 'hard' }));

      const { entries } = await repository.listByBadge('logica', 'hard');

      expect(entries).toHaveLength(1);
      expect(entries[0].difficulty).toBe('hard');
    });

    it('devolve os tres niveis quando nao ha filtro', async () => {
      // A visao da administracao sem aba selecionada. E por isso que
      // `badgeId` + `createdAt` e um indice de verdade, e nao prefixo do outro.
      const { repository } = makeRepository();
      await repository.createMany([
        data({ difficulty: 'easy' }),
        data({ difficulty: 'medium' }),
        data({ difficulty: 'hard' }),
      ]);

      const { entries } = await repository.listByBadge('logica');

      expect(entries).toHaveLength(3);
    });

    it('devolve lista vazia, e nao null, para insignia sem questao', async () => {
      const { repository } = makeRepository();

      await expect(repository.listByBadge('nestjs')).resolves.toEqual({
        entries: [],
      });
    });
  });

  describe('countByDifficulty', () => {
    it('conta os tres niveis, inclusive os zerados', async () => {
      // O zero e o numero que a tela do admin mais precisa: "Difíceis: 0/30" e
      // o que diz ao admin o que falta. Um agregado que omitisse a chave faria
      // a tela mostrar `undefined/30`.
      const { repository } = makeRepository();
      await repository.createMany([
        data({ difficulty: 'easy' }),
        data({ difficulty: 'easy' }),
        data({ difficulty: 'medium' }),
      ]);

      await expect(repository.countByDifficulty('logica')).resolves.toEqual({
        easy: 2,
        medium: 1,
        hard: 0,
      });
    });

    it('nao conta questao de outra insignia', async () => {
      const { repository } = makeRepository();
      await repository.create(data({ badgeId: 'poo' }));

      const counts = await repository.countByDifficulty('logica');

      expect(counts.easy).toBe(0);
    });
  });

  describe('findById e findByIds', () => {
    it('devolve found: false, e nao null cru, para id inexistente', async () => {
      const { repository } = makeRepository();

      await expect(repository.findById('nao-existe')).resolves.toEqual({
        found: false,
        entry: null,
      });
    });

    it('le pelos ids exatos e omite o que foi apagado', async () => {
      // O caso real: a rodada sorteou 10 questoes e o admin apagou uma no meio.
      // O `getAll` simplesmente nao devolve a que sumiu, e quem chama decide.
      const { repository } = makeRepository();
      const { entry } = await repository.create(data());

      const { entries } = await repository.findByIds([entry.id, 'apagada']);

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(entry.id);
    });

    it('nao chama o banco com lista vazia', async () => {
      const { repository } = makeRepository();

      await expect(repository.findByIds([])).resolves.toEqual({ entries: [] });
    });
  });

  describe('update', () => {
    it('altera o campo e sobe o updatedAt sem mexer no createdAt', async () => {
      const { repository } = makeRepository();
      const { entry } = await repository.create(data());

      const alterada = await repository.update(entry.id, {
        question: 'Outro enunciado, com mais de dez caracteres',
      });

      expect(alterada.found).toBe(true);
      expect(alterada.entry!.question).toBe(
        'Outro enunciado, com mais de dez caracteres',
      );
      expect(alterada.entry!.createdAt).toEqual(entry.createdAt);
    });

    it('move a resposta certa junto com as alternativas', async () => {
      // Alternativas e `correctIndex` andam juntos: reescrever a lista sem mexer
      // no indice deixa a certa apontando para outra frase, e nada denuncia.
      const { repository, firestore } = makeRepository();
      const { entry } = await repository.create(data());

      await repository.update(entry.id, {
        alternatives: ['A memória', 'A repetição', 'A ordem', 'O tipo'],
        correctIndex: 1,
      });

      expect(firestore.raw(`gym_questions/${entry.id}`)).toMatchObject({
        correctIndex: 1,
      });
    });

    it('devolve found: false para id inexistente', async () => {
      const { repository } = makeRepository();

      await expect(
        repository.update('nao-existe', { correctIndex: 2 }),
      ).resolves.toEqual({ found: false, entry: null });
    });
  });

  describe('delete', () => {
    it('apaga e diz que achou', async () => {
      const { repository, firestore } = makeRepository();
      const { entry } = await repository.create(data());

      await expect(repository.delete(entry.id)).resolves.toEqual({
        found: true,
      });
      expect(firestore.raw(`gym_questions/${entry.id}`)).toBeUndefined();
    });

    it('devolve found: false em vez de estourar', async () => {
      const { repository } = makeRepository();

      await expect(repository.delete('nao-existe')).resolves.toEqual({
        found: false,
      });
    });
  });

  describe('a armadilha do campo ausente', () => {
    it('questao sem difficulty nao aparece na consulta por nivel', async () => {
      // A mesma regra que fez a trilha sumir na spec 021 e o historico de
      // vencedoras vir vazio na 016: `where` **nao enxerga documento que nao tem
      // o campo**. Se um dia `difficulty` for acrescentado a uma colecao que ja
      // existe, o backfill nao e opcional -- e este teste e o lembrete.
      const { repository, firestore } = makeRepository();
      firestore.docs.set('gym_questions/antiga', {
        badgeId: 'logica',
        question: 'Enunciado sem nivel',
        alternatives: ['a', 'b', 'c', 'd'],
        correctIndex: 0,
      });

      const { entries } = await repository.listByBadge('logica', 'easy');

      expect(entries).toHaveLength(0);
    });
  });
});
