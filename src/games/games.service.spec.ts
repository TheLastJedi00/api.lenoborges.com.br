import { NotFoundException } from '@nestjs/common';
import { FakeFirestore } from '../track/testing/fake-firestore';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import { GamesService } from './games.service';
import { GymChallengeRepository } from './gym-challenge.repository';
import { GymQuestionRepository } from './gym-question.repository';
import { ChallengeConfigRepository } from './challenge-config.repository';
import { MIN_QUESTIONS_PER_DIFFICULTY } from './games.constants';
import type { Difficulty } from './games.constants';

export interface Harness {
  service: GamesService;
  firestore: FakeFirestore;
  challenges: GymChallengeRepository;
  questions: GymQuestionRepository;
  configs: ChallengeConfigRepository;
  profiles: { findById: jest.Mock };
  /** Enche o banco de uma insignia ate o desafio existir. */
  seedQuestions: (badgeId: string, perLevel?: number) => Promise<void>;
}

export function makeHarness(xp = 0): Harness {
  const firestore = new FakeFirestore();
  const firebase = { firestore } as unknown as FirebaseService;

  const challenges = new GymChallengeRepository(firebase);
  const questions = new GymQuestionRepository(firebase);
  const configs = new ChallengeConfigRepository(firebase);

  firestore.seedProfile('uid-1', xp);
  const profiles = {
    findById: jest.fn().mockImplementation((uid: string) =>
      Promise.resolve({
        found: true,
        entry: { id: uid, xp, grade: 0, nickname: 'LenoDev' },
      }),
    ),
  };

  const service = new GamesService(
    challenges,
    questions,
    configs,
    profiles as unknown as ProfileRepository,
  );

  const seedQuestions = async (
    badgeId: string,
    perLevel = MIN_QUESTIONS_PER_DIFFICULTY,
  ) => {
    for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
      await questions.createMany(
        Array.from({ length: perLevel }, (_, i) => ({
          badgeId: badgeId as 'logica',
          difficulty,
          question: `Enunciado ${difficulty} ${i}, com mais de dez caracteres`,
          alternatives: [`${i}-a`, `${i}-b`, `${i}-c`, `${i}-d`],
          correctIndex: i % 4,
        })),
      );
    }
  };

  return {
    service,
    firestore,
    challenges,
    questions,
    configs,
    profiles,
    seedQuestions,
  };
}

describe('GamesService — estado do desafio', () => {
  describe('getChallenge', () => {
    it('404 para insignia sem GYM Challenge', async () => {
      const { service } = makeHarness();

      await expect(service.getChallenge('uid-1', 'final-gcp')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('teste-trava: em-breve com XP de sobra, quando faltam questoes', async () => {
      // O XP nao compra o que nao existe. Sem as 90 questoes o desafio nao pode
      // ser aberto, por mais XP que o membro tenha.
      const { service, seedQuestions } = makeHarness(10_000);
      await seedQuestions('logica', 5);

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('em-breve');
    });

    it('teste-trava: em-breve quando so um nivel esta incompleto', async () => {
      // Noventa no total nao basta -- e este e o caso que um `total >= 90`
      // deixaria passar: 30 faceis, 30 medias e 29 dificeis somam 89, mas 45,
      // 45 e 0 somariam 90 e nao montariam uma rodada 3.
      const { service, questions, seedQuestions } = makeHarness(10_000);
      await seedQuestions('logica', 30);
      const { entries } = await questions.listByBadge('logica', 'hard');
      await questions.delete(entries[0].id);

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('em-breve');
    });

    it('xp-insuficiente quando o membro nao alcanca o minimo', async () => {
      const { service, configs, seedQuestions } = makeHarness(100);
      await seedQuestions('logica');
      await configs.save('logica', 500);

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('xp-insuficiente');
      expect(estado.requiredXp).toBe(500);
      expect(estado.currentXp).toBe(100);
    });

    it('disponivel quando ha questoes e XP', async () => {
      const { service, seedQuestions } = makeHarness(500);
      await seedQuestions('logica');

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('disponivel');
    });

    it('disponivel sem configuracao nenhuma: o default e zero', async () => {
      const { service, seedQuestions } = makeHarness(0);
      await seedQuestions('logica');

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('disponivel');
      expect(estado.requiredXp).toBe(0);
    });

    it('teste-trava: conquistada continua conquistada se o admin apagar questoes', async () => {
      // **O ponto Q.8, e a razao de `conquistada` ser testado antes de `ready`.**
      // Testar a ordem inversa faria a conquista de um membro desaparecer da tela
      // dele por causa de uma edicao no painel.
      const { service, challenges, seedQuestions } = makeHarness(500);
      await seedQuestions('logica', 5);
      await challenges.save({
        id: 'logica__uid-1',
        badgeId: 'logica',
        uid: 'uid-1',
        currentRound: 3,
        roundResults: {},
        badgeUnlocked: true,
        replaying: false,
        startedAt: new Date(),
        updatedAt: new Date(),
      });

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.status).toBe('conquistada');
      expect(estado.badgeUnlocked).toBe(true);
    });

    it('devolve as tres rodadas com a dificuldade de cada uma', async () => {
      const { service, seedQuestions } = makeHarness(500);
      await seedQuestions('logica');

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.rounds).toEqual([
        { round: 1, difficulty: 'easy', passed: false, score: null },
        { round: 2, difficulty: 'medium', passed: false, score: null },
        { round: 3, difficulty: 'hard', passed: false, score: null },
      ]);
    });

    it('hasActiveRound so quando ha questao sem resposta', async () => {
      // Dez respondidas e uma rodada que terminou e cuja limpeza falhou. O
      // botao certo ali e "Iniciar", e nao "Continuar" para uma prova acabada.
      const { service, challenges, seedQuestions } = makeHarness(500);
      await seedQuestions('logica');
      const { entry } = await challenges.get('logica', 'uid-1');
      await challenges.replaceActiveRound(entry, [
        {
          index: 0,
          questionId: 'q-0',
          question: 'Enunciado',
          alternatives: ['a', 'b', 'c', 'd'],
          correctAlternativeIndex: null,
          servedAt: new Date(),
          answeredAt: new Date(),
          chosenIndex: 1,
          correct: true,
          xpAwarded: 50,
          clientElapsedMs: 1000,
        },
      ]);

      await expect(
        service.getChallenge('uid-1', 'logica'),
      ).resolves.toMatchObject({ hasActiveRound: false });
    });

    it('replay quando a rodada corrente ja foi aprovada', async () => {
      const { service, challenges, seedQuestions } = makeHarness(500);
      await seedQuestions('logica');
      await challenges.save({
        id: 'logica__uid-1',
        badgeId: 'logica',
        uid: 'uid-1',
        currentRound: 1,
        roundResults: {
          1: { passed: true, score: 9, completedAt: new Date() },
        },
        badgeUnlocked: false,
        replaying: false,
        startedAt: new Date(),
        updatedAt: new Date(),
      });

      const estado = await service.getChallenge('uid-1', 'logica');

      expect(estado.replay).toBe(true);
      expect(estado.rounds[0]).toMatchObject({ passed: true, score: 9 });
    });
  });

  describe('listChallenges', () => {
    it('devolve as oito insignias, e so elas', async () => {
      const { service } = makeHarness();

      const lista = await service.listChallenges('uid-1');

      expect(lista).toHaveLength(8);
      expect(lista.map((item) => item.badgeId)).not.toContain('final-gcp');
    });

    it('cada insignia com o seu proprio estado', async () => {
      const { service, seedQuestions } = makeHarness(500);
      await seedQuestions('logica');

      const lista = await service.listChallenges('uid-1');
      const logica = lista.find((item) => item.badgeId === 'logica')!;
      const poo = lista.find((item) => item.badgeId === 'poo')!;

      expect(logica.status).toBe('disponivel');
      expect(poo.status).toBe('em-breve');
    });

    it('traz o titulo legivel de cada insignia', async () => {
      const { service } = makeHarness();

      const lista = await service.listChallenges('uid-1');

      expect(lista[0].badgeTitle).toBe('Insígnia da Lógica');
    });

    it('404 quando nao ha perfil', async () => {
      const { service, profiles } = makeHarness();
      profiles.findById.mockResolvedValue({ found: false, entry: null });

      await expect(service.listChallenges('uid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
