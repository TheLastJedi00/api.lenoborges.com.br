import {
  BadRequestException,
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
import type { AnswerResultDto } from './dto/answer-question.dto';

export interface Harness {
  service: GamesService;
  firestore: FakeFirestore;
  challenges: GymChallengeRepository;
  questions: GymQuestionRepository;
  configs: ChallengeConfigRepository;
  profiles: { findById: jest.Mock; update: jest.Mock };
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
    update: jest.fn().mockResolvedValue({ entry: {} }),
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

describe('GamesService — responder', () => {
  /** Abre uma rodada e devolve o gabarito de cada questao servida. */
  async function abrirRodada(h: Harness) {
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');
    const { entries } = await h.challenges.listActiveRound('logica', 'uid-1');

    return { servidas: entries };
  }

  it('acerto paga XP pela formula, sem o front conhecer o numero', async () => {
    const h = makeHarness(500);
    const { servidas } = await abrirRodada(h);

    const resultado = await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: servidas[0].correctAlternativeIndex!,
      clientElapsedMs: 3000,
    });

    expect(resultado.correct).toBe(true);
    expect(resultado.xpAwarded).toBe(50);
    expect(resultado.totalXp).toBe(550);
  });

  it('a penalidade de tempo desconta do sexto segundo em diante', async () => {
    // **O `servedAt` e envelhecido de proposito.** Sem isso o servidor mede ~0s
    // (o teste roda instantaneo), e um `clientElapsedMs` de 15s cai fora do teto
    // de `servidor + 2` e e descartado -- que e o comportamento certo, e nao o
    // que este teste quer medir. Para a penalidade existir, os dois relogios
    // precisam concordar, como concordam na vida real.
    const h = makeHarness(0);
    const { servidas } = await abrirRodada(h);
    const { entry } = await h.challenges.get('logica', 'uid-1');
    await h.challenges.replaceActiveRound(
      entry,
      servidas.map((questao) => ({
        ...questao,
        servedAt: new Date(Date.now() - 15_000),
      })),
    );
    const { entries } = await h.challenges.listActiveRound('logica', 'uid-1');

    const resultado = await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: entries[0].correctAlternativeIndex!,
      clientElapsedMs: 15_000,
    });

    expect(resultado.xpAwarded).toBe(40);
  });

  it('teste-trava: cliente alegando mais tempo que o servidor e descartado', async () => {
    // O teto de `servidor + 2` protege contra relogio dessincronizado, e o
    // efeito e sempre a favor do membro: quem alega ter demorado mais do que o
    // servidor mediu nao e punido por isso.
    const h = makeHarness(0);
    const { servidas } = await abrirRodada(h);

    const resultado = await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: servidas[0].correctAlternativeIndex!,
      clientElapsedMs: 45_000,
    });

    expect(resultado.xpAwarded).toBe(50);
  });

  it('erro paga zero e nao desconta nada', async () => {
    // Errar nao perde XP nenhum, nem da questao nem do acumulado (decisao 3).
    const h = makeHarness(500);
    const { servidas } = await abrirRodada(h);
    const errada = (servidas[0].correctAlternativeIndex! + 1) % 4;

    const resultado = await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: errada,
      clientElapsedMs: 3000,
    });

    expect(resultado.correct).toBe(false);
    expect(resultado.xpAwarded).toBe(0);
    expect(resultado.totalXp).toBe(500);
  });

  it('devolve qual era a certa, para a tela pintar de verde', async () => {
    const h = makeHarness(0);
    const { servidas } = await abrirRodada(h);
    const errada = (servidas[0].correctAlternativeIndex! + 1) % 4;

    const resultado = await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: errada,
      clientElapsedMs: 1000,
    });

    expect(resultado.correctAlternativeIndex).toBe(
      servidas[0].correctAlternativeIndex,
    );
  });

  it('teste-trava: a conferencia atravessa as duas ordens', async () => {
    // O chosenIndex e posicao na lista EMBARALHADA; o correctIndex da questao e
    // posicao na lista ORIGINAL. Compara-los direto acertaria por acaso em uma
    // de quatro questoes. Este teste responde todas as dez com o indice
    // embaralhado e exige dez acertos.
    const h = makeHarness(0);
    const { servidas } = await abrirRodada(h);

    for (const questao of servidas) {
      const resultado = await h.service.answer('uid-1', 'logica', {
        questionIndex: questao.index,
        chosenIndex: questao.correctAlternativeIndex!,
        clientElapsedMs: 1000,
      });

      expect(resultado.correct).toBe(true);
    }
  });

  it('400 quando nao ha rodada aberta naquele indice', async () => {
    const h = makeHarness(500);
    await abrirRodada(h);
    await h.challenges.clearActiveRound('logica', 'uid-1');

    await expect(
      h.service.answer('uid-1', 'logica', {
        questionIndex: 0,
        chosenIndex: 0,
        clientElapsedMs: 1000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('teste-trava: 409 na questao ja respondida, e sem pagar de novo', async () => {
    // A trava da dupla contagem. Nao ha ALREADY_EXISTS para segurar isto: o
    // documento ja existe e o lote o sobrescreve. Sem a conferencia de
    // answeredAt, reenviar a mesma resposta pagaria XP de novo -- um farm de um
    // clique repetido, sem exploit nenhum.
    const h = makeHarness(0);
    const { servidas } = await abrirRodada(h);

    await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: servidas[0].correctAlternativeIndex!,
      clientElapsedMs: 1000,
    });

    await expect(
      h.service.answer('uid-1', 'logica', {
        questionIndex: 0,
        chosenIndex: servidas[0].correctAlternativeIndex!,
        clientElapsedMs: 1000,
      }),
    ).rejects.toThrow(ConflictException);

    expect(h.firestore.raw('profiles/uid-1')!.xp).toBe(50);
  });

  it('o XP entra no perfil no mesmo lote da resposta', async () => {
    const h = makeHarness(100);
    const { servidas } = await abrirRodada(h);

    await h.service.answer('uid-1', 'logica', {
      questionIndex: 0,
      chosenIndex: servidas[0].correctAlternativeIndex!,
      clientElapsedMs: 1000,
    });

    expect(h.firestore.raw('profiles/uid-1')!.xp).toBe(150);
    expect(
      h.firestore.raw('gym_challenges/logica__uid-1/active_round/0')!.correct,
    ).toBe(true);
  });
});

describe('GamesService — fim de rodada', () => {
  /** Responde a rodada inteira acertando `acertos` das dez. */
  async function jogarRodada(h: Harness, acertos: number, badge = 'logica') {
    const { entries } = await h.challenges.listActiveRound(
      badge as 'logica',
      'uid-1',
    );
    // Tipado, e nao `let ultimo;`: sem o tipo o TypeScript infere `any`, e o
    // teste passa a afirmar propriedades que ninguem confere -- um `score` que
    // virasse `scores` ficaria `undefined` e o `toBe(7)` falharia com uma
    // mensagem sobre o valor, e nao sobre o nome errado.
    let ultimo: AnswerResultDto | undefined;

    for (const questao of entries) {
      const certa = questao.correctAlternativeIndex!;
      const escolha = questao.index < acertos ? certa : (certa + 1) % 4;

      ultimo = await h.service.answer('uid-1', badge, {
        questionIndex: questao.index,
        chosenIndex: escolha,
        clientElapsedMs: 1000,
      });
    }

    return ultimo!;
  }

  it('7 de 10 aprova e avanca a rodada', async () => {
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');

    const fim = await jogarRodada(h, 7);

    expect(fim.roundComplete).toBe(true);
    expect(fim.score).toBe(7);
    expect(fim.roundPassed).toBe(true);
    expect(fim.nextRound).toBe(2);

    const { entry } = await h.challenges.get('logica', 'uid-1');
    expect(entry.currentRound).toBe(2);
  });

  it('6 de 10 reprova e mantem a rodada', async () => {
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');

    const fim = await jogarRodada(h, 6);

    expect(fim.roundPassed).toBe(false);
    expect(fim.nextRound).toBeUndefined();

    const { entry } = await h.challenges.get('logica', 'uid-1');
    expect(entry.currentRound).toBe(1);
    expect(entry.roundResults[1]!.score).toBe(6);
  });

  it('teste-trava: reprovar nao reseta as rodadas anteriores', async () => {
    // Quem passou na facil e reprovou na media volta direto para a media, sem
    // refazer a facil (decisao 2).
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');
    await jogarRodada(h, 10);
    await h.service.startRound('uid-1', 'logica');

    await jogarRodada(h, 3);

    const { entry } = await h.challenges.get('logica', 'uid-1');
    expect(entry.roundResults[1]!.passed).toBe(true);
    expect(entry.currentRound).toBe(2);
  });

  it('a terceira aprovada desbloqueia a insignia e sobe o grade', async () => {
    const h = makeHarness(0);
    await h.seedQuestions('logica');

    for (let rodada = 1; rodada <= 3; rodada += 1) {
      await h.service.startRound('uid-1', 'logica');
      const fim = await jogarRodada(h, 10);

      if (rodada === 3) {
        expect(fim.badgeUnlocked).toBe(true);
        expect(fim.grade).toBe(1);
      } else {
        expect(fim.badgeUnlocked).toBeUndefined();
      }
    }

    const { entry } = await h.challenges.get('logica', 'uid-1');
    expect(entry.badgeUnlocked).toBe(true);
  });

  it('teste-trava: conquistar fora de ordem nao sobe o grade', async () => {
    // A invariante da spec 008 (decisao 13): grade conta etapas em sequencia.
    // O membro ganha os selos e o XP, e nao ganha a posicao 2 sem a 1.
    const h = makeHarness(0);
    await h.seedQuestions('poo');

    for (let rodada = 1; rodada <= 3; rodada += 1) {
      await h.service.startRound('uid-1', 'poo');
      await jogarRodada(h, 10, 'poo');
    }

    const { entry } = await h.challenges.get('poo', 'uid-1');
    expect(entry.badgeUnlocked).toBe(true);
    expect(h.profiles.update).not.toHaveBeenCalled();
  });

  it('a subcolecao e apagada ao fim da rodada', async () => {
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');

    await jogarRodada(h, 10);

    expect(
      h.firestore.countUnder('gym_challenges/logica__uid-1/active_round'),
    ).toBe(0);
  });

  it('teste-trava: replay nao paga XP e nao toca o roundResults', async () => {
    // A rodada ja foi aprovada, e um replay reprovado nao pode apagar a
    // aprovacao original (decisao 21).
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');
    await jogarRodada(h, 10);
    const xpDepoisDaPrimeira = h.firestore.raw('profiles/uid-1')!.xp;

    const { entry } = await h.challenges.get('logica', 'uid-1');
    await h.challenges.save({ ...entry, currentRound: 1 });
    const rodada = await h.service.startRound('uid-1', 'logica');
    expect(rodada.replay).toBe(true);

    const fim = await jogarRodada(h, 3);

    expect(fim.xpAwarded).toBe(0);
    expect(fim.replay).toBe(true);
    expect(h.firestore.raw('profiles/uid-1')!.xp).toBe(xpDepoisDaPrimeira);

    const depois = await h.challenges.get('logica', 'uid-1');
    expect(depois.entry.roundResults[1]!.passed).toBe(true);
    expect(depois.entry.roundResults[1]!.score).toBe(10);
  });

  it('o replaying volta a false depois do treino', async () => {
    // Senao a proxima rodada de verdade tambem nao pagaria XP.
    const h = makeHarness(0);
    await h.seedQuestions('logica');
    await h.service.startRound('uid-1', 'logica');
    await jogarRodada(h, 10);
    const { entry } = await h.challenges.get('logica', 'uid-1');
    await h.challenges.save({ ...entry, currentRound: 1 });
    await h.service.startRound('uid-1', 'logica');

    await jogarRodada(h, 10);

    const depois = await h.challenges.get('logica', 'uid-1');
    expect(depois.entry.replaying).toBe(false);
  });
});
