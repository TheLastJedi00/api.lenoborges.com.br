import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
