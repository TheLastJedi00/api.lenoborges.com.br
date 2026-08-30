import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminGamesController } from './admin-games.controller';
import { GymQuestionService } from './gym-question.service';
import { GeminiService } from './gemini.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { GymQuestion } from './entities/gym-question.entity';
import { CreateQuestionDto } from './dto/create-question.dto';

const AGORA = new Date('2026-08-30T12:00:00.000Z');

function questao(extra: Partial<GymQuestion> = {}): GymQuestion {
  return {
    id: 'q-1',
    badgeId: 'logica',
    difficulty: 'easy',
    question: 'O que um laço `for` controla?',
    alternatives: ['A repetição', 'A memória', 'A ordem', 'O tipo'],
    correctIndex: 0,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...extra,
  };
}

function dto(extra: Partial<CreateQuestionDto> = {}): CreateQuestionDto {
  return {
    difficulty: 'easy',
    question: 'O que um laço `for` controla?',
    alternatives: ['A repetição', 'A memória', 'A ordem', 'O tipo'],
    correctIndex: 0,
    ...extra,
  };
}

describe('AdminGamesController', () => {
  let controller: AdminGamesController;
  let service: {
    list: jest.Mock;
    counts: jest.Mock;
    create: jest.Mock;
    createMany: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  let gemini: { generate: jest.Mock };

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([questao()]),
      counts: jest.fn().mockResolvedValue({
        easy: 1,
        medium: 0,
        hard: 0,
        total: 1,
        ready: false,
      }),
      create: jest.fn().mockResolvedValue(questao()),
      createMany: jest.fn().mockResolvedValue([questao(), questao()]),
      update: jest.fn().mockResolvedValue(questao({ correctIndex: 2 })),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    gemini = {
      generate: jest.fn().mockResolvedValue({
        questions: [dto()],
        discarded: 2,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminGamesController],
      providers: [
        { provide: GymQuestionService, useValue: service },
        { provide: GeminiService, useValue: gemini },
      ],
    })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminGamesController);
  });

  describe('GET /admin/badges/:badgeId/questions', () => {
    it('devolve as questoes com a contagem no mesmo corpo', async () => {
      // A contagem e o cabecalho da tela. Numa segunda rota seria a mesma
      // leitura duas vezes, a cada abertura.
      const resposta = await controller.list('logica');

      expect(resposta.questions).toHaveLength(1);
      expect(resposta.counts).toEqual({
        easy: 1,
        medium: 0,
        hard: 0,
        total: 1,
        ready: false,
      });
    });

    it('repassa a dificuldade quando ela e valida', async () => {
      await controller.list('logica', 'hard');

      expect(service.list).toHaveBeenCalledWith('logica', 'hard');
    });

    it('ignora dificuldade que nao existe, em vez de filtrar por lixo', async () => {
      // Um valor invalido e uma aba que nao existe na tela. Repassa-lo ao
      // service devolveria lista vazia sob o rotulo de uma aba real.
      await controller.list('logica', 'impossivel');

      expect(service.list).toHaveBeenCalledWith('logica', undefined);
    });

    it('propaga o 404 de insignia sem desafio', async () => {
      service.list.mockRejectedValue(new NotFoundException());
      service.counts.mockRejectedValue(new NotFoundException());

      await expect(controller.list('final-gcp')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('POST /admin/badges/:badgeId/questions', () => {
    it('cria e devolve a questao ja em DTO', async () => {
      const criada = await controller.create('logica', dto());

      expect(service.create).toHaveBeenCalledWith('logica', dto());
      expect(criada.id).toBe('q-1');
      expect(criada.createdAt).toBe('2026-08-30T12:00:00.000Z');
    });

    it('a rota de admin e a unica que devolve o correctIndex', async () => {
      // Este e o unico controller do produto em que a resposta certa trafega, e
      // e o `AdminGuard` no controller inteiro que o sustenta. O DTO do membro
      // -- `RoundQuestionDto` -- nao tem o campo, e nao e este objeto com um
      // `delete` em cima.
      const criada = await controller.create('logica', dto());

      expect(criada.correctIndex).toBe(0);
    });
  });

  describe('POST /admin/badges/:badgeId/questions/generate', () => {
    it('devolve o rascunho e a contagem de descartadas', async () => {
      const rascunho = await controller.generate('logica', {
        prompt: 'laços e condicionais em Java',
        difficulty: 'easy',
        count: 10,
      });

      expect(rascunho.questions).toHaveLength(1);
      // O admin precisa ver que pediu 10 e revisou 1. Sem o numero, o rascunho
      // curto parece um limite do produto.
      expect(rascunho.discarded).toBe(2);
    });

    it('nao grava nada', async () => {
      // Rascunho e proposta. O que grava e o bulk, depois que o admin editou e
      // escolheu -- e essa separacao e o que impede uma questao errada de entrar
      // no banco por descuido de um modelo.
      await controller.generate('logica', {
        prompt: 'laços e condicionais em Java',
        difficulty: 'easy',
        count: 10,
      });

      expect(service.create).not.toHaveBeenCalled();
      expect(service.createMany).not.toHaveBeenCalled();
    });

    it('confere a insignia antes de gastar a chamada paga', async () => {
      // Gerar trinta questoes para uma insignia que nao existe custaria a
      // chamada inteira para depois responder 404 no bulk.
      service.counts.mockRejectedValue(new NotFoundException());

      await expect(
        controller.generate('final-gcp', {
          prompt: 'laços e condicionais em Java',
          difficulty: 'easy',
          count: 10,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(gemini.generate).not.toHaveBeenCalled();
    });

    it('manda o titulo da insignia junto do tema', async () => {
      await controller.generate('poo', {
        prompt: 'herança e polimorfismo',
        difficulty: 'medium',
        count: 20,
      });

      expect(gemini.generate).toHaveBeenCalledWith({
        badgeTitle: 'Insígnia da POO',
        prompt: 'herança e polimorfismo',
        difficulty: 'medium',
        count: 20,
      });
    });
  });

  describe('POST /admin/badges/:badgeId/questions/bulk', () => {
    it('grava o lote e devolve as questoes com id', async () => {
      const gravadas = await controller.bulk('logica', {
        questions: [dto(), dto({ difficulty: 'hard' })],
      });

      expect(service.createMany).toHaveBeenCalledWith('logica', [
        dto(),
        dto({ difficulty: 'hard' }),
      ]);
      expect(gravadas.questions).toHaveLength(2);
      expect(gravadas.questions[0].id).toBe('q-1');
    });
  });

  describe('PATCH e DELETE', () => {
    it('edita repassando o badgeId do caminho', async () => {
      const alterada = await controller.update('logica', 'q-1', {
        correctIndex: 2,
      });

      expect(service.update).toHaveBeenCalledWith('logica', 'q-1', {
        correctIndex: 2,
      });
      expect(alterada.correctIndex).toBe(2);
    });

    it('remove sem devolver corpo', async () => {
      await expect(controller.remove('logica', 'q-1')).resolves.toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith('logica', 'q-1');
    });

    it('propaga o 404 de questao de outra insignia', async () => {
      service.update.mockRejectedValue(new NotFoundException());

      await expect(
        controller.update('poo', 'q-1', { correctIndex: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
