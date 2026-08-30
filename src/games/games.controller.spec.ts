import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import type { ChallengeStateDto } from './dto/challenge-state.dto';

const USER = { id: 'uid-1', email: 'a@b.c', role: null } as CurrentUserData;

function estado(extra: Partial<ChallengeStateDto> = {}): ChallengeStateDto {
  return {
    badgeId: 'logica',
    badgeTitle: 'Insígnia da Lógica',
    status: 'disponivel',
    currentRound: 1,
    rounds: [
      { round: 1, difficulty: 'easy', passed: false, score: null },
      { round: 2, difficulty: 'medium', passed: false, score: null },
      { round: 3, difficulty: 'hard', passed: false, score: null },
    ],
    requiredXp: 0,
    currentXp: 340,
    badgeUnlocked: false,
    hasActiveRound: false,
    replay: false,
    ...extra,
  };
}

describe('GamesController', () => {
  let controller: GamesController;
  let games: { listChallenges: jest.Mock; getChallenge: jest.Mock };

  beforeEach(async () => {
    games = {
      listChallenges: jest.fn().mockResolvedValue([estado()]),
      getChallenge: jest.fn().mockResolvedValue(estado()),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GamesController],
      providers: [{ provide: GamesService, useValue: games }],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GamesController);
  });

  it('lista os desafios do membro autenticado', async () => {
    const resposta = await controller.list(USER);

    expect(games.listChallenges).toHaveBeenCalledWith('uid-1');
    expect(resposta.challenges).toHaveLength(1);
  });

  it('devolve o detalhe da insignia pedida', async () => {
    const resposta = await controller.detail(USER, 'logica');

    expect(games.getChallenge).toHaveBeenCalledWith('uid-1', 'logica');
    expect(resposta.badgeId).toBe('logica');
  });

  it('propaga o 404 de insignia sem desafio', async () => {
    games.getChallenge.mockRejectedValue(new NotFoundException());

    await expect(controller.detail(USER, 'final-gcp')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('teste-trava: o estado nao carrega correctIndex nenhum', async () => {
    // O que sai por rota de membro nunca tem a resposta certa. Este teste e a
    // segunda linha de defesa depois do DTO -- a primeira e o `RoundQuestionDto`
    // nao ter o campo, e a terceira e o AdminGuard do outro controller.
    const resposta = (await controller.detail(
      USER,
      'logica',
    )) as unknown as Record<string, unknown>;

    expect(resposta.correctIndex).toBeUndefined();
    expect(JSON.stringify(resposta)).not.toContain('correctIndex');
  });
});

describe('GamesController — start', () => {
  let controller: GamesController;
  let games: {
    listChallenges: jest.Mock;
    getChallenge: jest.Mock;
    startRound: jest.Mock;
  };

  beforeEach(async () => {
    games = {
      listChallenges: jest.fn(),
      getChallenge: jest.fn(),
      startRound: jest.fn().mockResolvedValue({
        round: 1,
        difficulty: 'easy',
        replay: false,
        questions: [
          {
            index: 0,
            question: 'Enunciado',
            alternatives: ['a', 'b', 'c', 'd'],
          },
        ],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GamesController],
      providers: [{ provide: GamesService, useValue: games }],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GamesController);
  });

  it('inicia a rodada do membro autenticado', async () => {
    const rodada = await controller.start(USER, 'logica');

    expect(games.startRound).toHaveBeenCalledWith('uid-1', 'logica');
    expect(rodada.questions).toHaveLength(1);
  });

  it('teste-trava: o corpo nao tem a chave correctIndex', async () => {
    // Um teste que afirma a AUSENCIA da chave, e nao toMatchObject -- aquele
    // passa feliz com um campo a mais, que aqui seria a resposta certa no
    // trafego de quem esta jogando.
    const rodada = await controller.start(USER, 'logica');

    for (const questao of rodada.questions) {
      expect(Object.keys(questao)).not.toContain('correctIndex');
      expect(Object.keys(questao)).not.toContain('correctAlternativeIndex');
      expect(Object.keys(questao)).not.toContain('questionId');
    }
  });

  it('propaga o 403 de desafio indisponivel', async () => {
    games.startRound.mockRejectedValue(new ForbiddenException());

    await expect(controller.start(USER, 'logica')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('propaga o 403 de XP insuficiente', async () => {
    games.startRound.mockRejectedValue(
      new ForbiddenException('Você precisa de mais XP'),
    );

    await expect(controller.start(USER, 'logica')).rejects.toThrow(/mais XP/);
  });

  it('propaga o 409 de rodada em andamento', async () => {
    games.startRound.mockRejectedValue(new ConflictException());

    await expect(controller.start(USER, 'logica')).rejects.toThrow(
      ConflictException,
    );
  });
});
