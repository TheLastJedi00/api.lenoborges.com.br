import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { GymChallengeRepository } from './gym-challenge.repository';
import {
  GymChallenge,
  initialChallenge,
} from './entities/gym-challenge.entity';
import { ActiveRoundQuestion } from './entities/active-round-question.entity';

function makeRepository(): {
  repository: GymChallengeRepository;
  firestore: FakeFirestore;
} {
  const firestore = new FakeFirestore();

  return {
    repository: new GymChallengeRepository({
      firestore,
    } as unknown as FirebaseService),
    firestore,
  };
}

function questao(index: number): ActiveRoundQuestion {
  return {
    index,
    questionId: `q-${index}`,
    question: `Enunciado ${index}`,
    alternatives: ['a', 'b', 'c', 'd'],
    correctAlternativeIndex: null,
    servedAt: new Date('2026-08-30T12:00:00.000Z'),
    answeredAt: null,
    chosenIndex: null,
    correct: null,
    xpAwarded: null,
    clientElapsedMs: null,
  };
}

function desafio(extra: Partial<GymChallenge> = {}): GymChallenge {
  return { ...initialChallenge('logica', 'uid-1'), ...extra };
}

describe('GymChallengeRepository', () => {
  describe('get', () => {
    it('devolve o estado inicial para quem nunca jogou, e nao null', async () => {
      // Quem nunca jogou nao tem documento, e esse e o estado normal de quase
      // todo mundo em quase toda insignia. "No comeco" e uma resposta valida.
      const { repository } = makeRepository();

      const { found, entry } = await repository.get('logica', 'uid-1');

      expect(found).toBe(false);
      expect(entry.currentRound).toBe(1);
      expect(entry.badgeUnlocked).toBe(false);
      expect(entry.roundResults).toEqual({});
    });

    it('devolve o estado gravado', async () => {
      const { repository } = makeRepository();
      await repository.save(desafio({ currentRound: 2 }));

      const { found, entry } = await repository.get('logica', 'uid-1');

      expect(found).toBe(true);
      expect(entry.currentRound).toBe(2);
    });
  });

  describe('getMany', () => {
    it('devolve todas as insignias pedidas, jogadas ou nao', async () => {
      const { repository } = makeRepository();
      await repository.save(desafio({ currentRound: 3 }));

      const mapa = await repository.getMany(['logica', 'poo'], 'uid-1');

      expect(mapa.size).toBe(2);
      expect(mapa.get('logica')!.currentRound).toBe(3);
      expect(mapa.get('poo')!.currentRound).toBe(1);
    });

    it('nao mistura o desafio de outro membro', async () => {
      const { repository } = makeRepository();
      await repository.save(
        desafio({
          id: 'logica__uid-2',
          uid: 'uid-2',
          currentRound: 3,
        }),
      );

      const mapa = await repository.getMany(['logica'], 'uid-1');

      expect(mapa.get('logica')!.currentRound).toBe(1);
    });
  });

  describe('replaceActiveRound', () => {
    it('grava as dez questoes da rodada', async () => {
      const { repository, firestore } = makeRepository();

      await repository.replaceActiveRound(
        desafio(),
        Array.from({ length: 10 }, (_, index) => questao(index)),
      );

      expect(
        firestore.countUnder('gym_challenges/logica__uid-1/active_round'),
      ).toBe(10);
    });

    it('teste-trava: recomecar substitui a rodada inteira', async () => {
      // Sem o delete, uma rodada de dez seguida de outra de dez deixaria vinte
      // documentos, e a segunda tentativa teria as questoes das duas misturadas.
      // Um lote, ou existe um instante em que a rodada tem quatro velhas e seis
      // novas -- e quem recarregar nesse instante joga uma prova que nunca
      // existiu.
      const { repository, firestore } = makeRepository();
      await repository.replaceActiveRound(
        desafio(),
        Array.from({ length: 10 }, (_, index) => questao(index)),
      );

      await repository.replaceActiveRound(desafio(), [questao(0), questao(1)]);

      expect(
        firestore.countUnder('gym_challenges/logica__uid-1/active_round'),
      ).toBe(2);
    });

    it('grava o documento pai no mesmo lote', async () => {
      const { repository, firestore } = makeRepository();

      await repository.replaceActiveRound(desafio({ replaying: true }), [
        questao(0),
      ]);

      expect(firestore.raw('gym_challenges/logica__uid-1')).toMatchObject({
        replaying: true,
      });
    });
  });

  describe('listActiveRound', () => {
    it('devolve em ordem numerica, e nao alfabetica', async () => {
      // Ordenar por documentId() no Firestore ordenaria como texto, e '10'
      // viria antes de '2'. A rodada apareceria fora de ordem para o membro.
      const { repository } = makeRepository();
      await repository.replaceActiveRound(desafio(), [
        questao(9),
        questao(0),
        questao(10),
        questao(2),
      ]);

      const { entries } = await repository.listActiveRound('logica', 'uid-1');

      expect(entries.map((entry) => entry.index)).toEqual([0, 2, 9, 10]);
    });

    it('devolve lista vazia quando nao ha rodada aberta', async () => {
      const { repository } = makeRepository();

      await expect(
        repository.listActiveRound('logica', 'uid-1'),
      ).resolves.toEqual({ entries: [] });
    });
  });

  describe('recordAnswer', () => {
    it('grava a resposta e incrementa o XP no mesmo lote', async () => {
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1', 100);
      await repository.replaceActiveRound(desafio(), [questao(0)]);

      await repository.recordAnswer(
        'logica',
        'uid-1',
        {
          ...questao(0),
          answeredAt: new Date(),
          chosenIndex: 2,
          correct: true,
          xpAwarded: 47,
          correctAlternativeIndex: 2,
        },
        47,
      );

      expect(firestore.raw('profiles/uid-1')!.xp).toBe(147);
      expect(
        firestore.raw('gym_challenges/logica__uid-1/active_round/0'),
      ).toMatchObject({ correct: true, xpAwarded: 47 });
    });

    it('resposta errada nao toca no XP', async () => {
      // Errar nao desconta e nao paga (decisao 3). Um increment de zero seria
      // uma escrita a mais no perfil por nada.
      const { repository, firestore } = makeRepository();
      firestore.seedProfile('uid-1', 100);
      await repository.replaceActiveRound(desafio(), [questao(0)]);

      await repository.recordAnswer(
        'logica',
        'uid-1',
        {
          ...questao(0),
          answeredAt: new Date(),
          chosenIndex: 1,
          correct: false,
          xpAwarded: 0,
        },
        0,
      );

      expect(firestore.raw('profiles/uid-1')!.xp).toBe(100);
    });
  });

  describe('removeAll', () => {
    it('apaga a subcolecao antes do pai', async () => {
      // Quinta vez que este produto esbarra em "subcolecao nao some com o pai".
      // Apagar o pai primeiro deixaria os dez documentos orfaos: invisiveis,
      // cobrados e impossiveis de encontrar depois.
      const { repository, firestore } = makeRepository();
      await repository.replaceActiveRound(
        desafio(),
        Array.from({ length: 10 }, (_, index) => questao(index)),
      );

      await repository.removeAll('uid-1', ['logica', 'poo']);

      expect(
        firestore.countUnder('gym_challenges/logica__uid-1/active_round'),
      ).toBe(0);
      expect(firestore.raw('gym_challenges/logica__uid-1')).toBeUndefined();
    });
  });
});
