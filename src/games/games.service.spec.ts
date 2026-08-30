import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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

describe('GamesService — iniciar a rodada', () => {
  it('sorteia dez questoes da dificuldade da rodada corrente', async () => {
    const { service, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');

    const rodada = await service.startRound('uid-1', 'logica');

    expect(rodada.round).toBe(1);
    expect(rodada.difficulty).toBe('easy');
    expect(rodada.questions).toHaveLength(10);
  });

  it('a rodada 2 sorteia das medias', async () => {
    const { service, challenges, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');
    const { entry } = await challenges.get('logica', 'uid-1');
    await challenges.save({ ...entry, currentRound: 2 });

    await expect(service.startRound('uid-1', 'logica')).resolves.toMatchObject({
      round: 2,
      difficulty: 'medium',
    });
  });

  it('teste-trava: a resposta nao carrega correctIndex nem questionId', async () => {
    // Num questionario, a resposta certa no trafego e cola -- e o `questionId`
    // seria o caminho para ler a questao original por outra rota qualquer.
    const { service, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');

    const rodada = await service.startRound('uid-1', 'logica');

    for (const questao of rodada.questions) {
      expect(Object.keys(questao).sort()).toEqual([
        'alternatives',
        'index',
        'question',
      ]);
    }
    expect(JSON.stringify(rodada)).not.toContain('correctIndex');
    expect(JSON.stringify(rodada)).not.toContain('correctAlternativeIndex');
  });

  it('grava a rodada com o indice da correta ja embaralhado', async () => {
    // O indice fica no servidor: e ele que o `answer` usa para dizer qual era a
    // certa, sem reler a questao original numa ordem que ja mudou.
    const { service, challenges, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');

    await service.startRound('uid-1', 'logica');
    const { entries } = await challenges.listActiveRound('logica', 'uid-1');

    expect(entries).toHaveLength(10);
    for (const questao of entries) {
      expect(questao.correctAlternativeIndex).toBeGreaterThanOrEqual(0);
      expect(questao.correctAlternativeIndex).toBeLessThanOrEqual(3);
      expect(questao.answeredAt).toBeNull();
    }
  });

  it('403 quando faltam questoes', async () => {
    const { service, seedQuestions } = makeHarness(500);
    await seedQuestions('logica', 5);

    await expect(service.startRound('uid-1', 'logica')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('403 quando falta XP', async () => {
    const { service, configs, seedQuestions } = makeHarness(100);
    await seedQuestions('logica');
    await configs.save('logica', 500);

    await expect(service.startRound('uid-1', 'logica')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('teste-trava: a insignia sem questoes recusa antes de falar de XP', async () => {
    // A ordem das recusas importa para a mensagem que o membro le: invertida,
    // alguem sem XP numa insignia sem questoes seria mandado treinar para algo
    // que nao vai existir.
    const { service, configs, seedQuestions } = makeHarness(0);
    await seedQuestions('logica', 5);
    await configs.save('logica', 500);

    await expect(service.startRound('uid-1', 'logica')).rejects.toThrow(
      /ainda não está disponível/,
    );
  });

  it('409 quando ja ha rodada aberta', async () => {
    const { service, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');
    await service.startRound('uid-1', 'logica');

    await expect(service.startRound('uid-1', 'logica')).rejects.toThrow(
      ConflictException,
    );
  });

  it('rodada com as dez respondidas nao bloqueia um novo start', async () => {
    // Uma rodada terminada cuja limpeza falhou. Recusar ali prenderia o membro
    // numa prova acabada sem nenhuma forma de sair.
    const { service, challenges, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');
    await service.startRound('uid-1', 'logica');
    const { entries } = await challenges.listActiveRound('logica', 'uid-1');
    const { entry } = await challenges.get('logica', 'uid-1');
    await challenges.replaceActiveRound(
      entry,
      entries.map((questao) => ({
        ...questao,
        answeredAt: new Date(),
        chosenIndex: 0,
        correct: true,
        xpAwarded: 50,
      })),
    );

    await expect(service.startRound('uid-1', 'logica')).resolves.toBeDefined();
  });

  it('replay: true ao refazer uma rodada ja aprovada', async () => {
    const { service, challenges, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');
    const { entry } = await challenges.get('logica', 'uid-1');
    await challenges.save({
      ...entry,
      currentRound: 1,
      roundResults: { 1: { passed: true, score: 9, completedAt: new Date() } },
    });

    const rodada = await service.startRound('uid-1', 'logica');

    expect(rodada.replay).toBe(true);
  });

  it('o flag replaying fica no documento pai, e nao nas questoes', async () => {
    // E propriedade da RODADA. Gravar em dez lugares o que e verdade uma vez so
    // abre a chance de nove concordarem e um discordar.
    const { service, challenges, firestore, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');
    const { entry } = await challenges.get('logica', 'uid-1');
    await challenges.save({
      ...entry,
      roundResults: { 1: { passed: true, score: 9, completedAt: new Date() } },
    });

    await service.startRound('uid-1', 'logica');

    expect(firestore.raw('gym_challenges/logica__uid-1')!.replaying).toBe(true);
  });

  it('duas rodadas seguidas nao servem exatamente as mesmas questoes', async () => {
    // Com 30 questoes por nivel e 10 por rodada, a chance de as duas listas
    // saírem identicas e desprezivel -- e a razao do minimo de 30 (decisao 5).
    const { service, challenges, seedQuestions } = makeHarness(500);
    await seedQuestions('logica');

    const primeira = await service.startRound('uid-1', 'logica');
    await challenges.clearActiveRound('logica', 'uid-1');
    const segunda = await service.startRound('uid-1', 'logica');

    const a = primeira.questions.map((q) => q.question).join('|');
    const b = segunda.questions.map((q) => q.question).join('|');

    expect(a).not.toBe(b);
  });
});
