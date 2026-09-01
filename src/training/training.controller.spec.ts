import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

const ANA = { id: 'ana', email: 'ana@exemplo.com' } as CurrentUserData;

describe('TrainingController', () => {
  let service: jest.Mocked<TrainingService>;
  let controller: TrainingController;

  beforeEach(() => {
    service = {
      listByBadge: jest.fn(),
      getOne: jest.fn(),
      complete: jest.fn(),
      listComments: jest.fn(),
      addComment: jest.fn(),
    } as unknown as jest.Mocked<TrainingService>;

    controller = new TrainingController(service);
  });

  describe('GET /badges/:badgeId/trainings', () => {
    /**
     * **O `uid` da sessão, e nunca um da URL.**
     *
     * O `completed` é de quem pediu. Um `uid` que viesse do cliente deixaria
     * qualquer pessoa ler o progresso de qualquer outra passando o id na
     * requisição -- sem erro, com 200, e sem nada na tela indicando isso.
     */
    it('passa o uid da sessão para o service', async () => {
      service.listByBadge.mockResolvedValue({
        badgeId: 'logica',
        trainings: [],
      });

      await controller.list(ANA, 'logica');

      expect(service.listByBadge).toHaveBeenCalledWith('ana', 'logica');
    });

    it('deixa o 404 de insígnia inexistente subir', async () => {
      service.listByBadge.mockRejectedValue(new NotFoundException());

      await expect(controller.list(ANA, 'nao-existe')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('GET /trainings/:trainingId', () => {
    it('deixa o 404 de treinamento inexistente subir', async () => {
      service.getOne.mockRejectedValue(new NotFoundException());

      await expect(controller.getOne(ANA, 'fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('POST /trainings/:trainingId/complete', () => {
    it('conclui em nome de quem está logado', async () => {
      service.complete.mockResolvedValue({
        trainingId: 'trn-1',
        completed: true,
        xpAwarded: 30,
        xp: 30,
      });

      const resposta = await controller.complete(ANA, 'trn-1');

      expect(service.complete).toHaveBeenCalledWith('ana', 'trn-1');
      expect(resposta.xp).toBe(30);
    });

    /**
     * A segunda conclusão é sucesso, e não conflito.
     *
     * O desafio está concluído, que é o que quem clicou queria. Um 409 aqui
     * obrigaria a tela a tratar como erro o caso mais comum de todos: o duplo
     * clique.
     */
    it('responde sucesso na conclusão repetida, com xpAwarded zero', async () => {
      service.complete.mockResolvedValue({
        trainingId: 'trn-1',
        completed: true,
        xpAwarded: 0,
        xp: 30,
      });

      const resposta = await controller.complete(ANA, 'trn-1');

      expect(resposta.completed).toBe(true);
      expect(resposta.xpAwarded).toBe(0);
    });
  });

  describe('GET /trainings/:trainingId/comments', () => {
    beforeEach(() => {
      service.listComments.mockResolvedValue({
        comments: [],
        nextCursor: null,
      });
    });

    it('sem query, deixa o service aplicar o padrão', async () => {
      await controller.listComments('trn-1');

      expect(service.listComments).toHaveBeenCalledWith('trn-1', {
        limit: undefined,
        after: undefined,
      });
    });

    it('converte o `limit` da query string em número', async () => {
      await controller.listComments('trn-1', '25', 'cmt-9');

      expect(service.listComments).toHaveBeenCalledWith('trn-1', {
        limit: 25,
        after: 'cmt-9',
      });
    });

    /**
     * Um `limit` ilegível vira `NaN` e o service recusa.
     *
     * Cair no padrão silenciosamente esconderia o engano de quem chamou, e a
     * tela mostraria dez comentários achando que pediu outra coisa.
     */
    it('não conserta um `limit` que não é número', async () => {
      await controller.listComments('trn-1', 'abc');

      expect(service.listComments).toHaveBeenCalledWith('trn-1', {
        limit: NaN,
        after: undefined,
      });
    });
  });

  describe('POST /trainings/:trainingId/comments', () => {
    it('comenta em nome de quem está logado', async () => {
      service.addComment.mockResolvedValue({
        id: 'cmt-1',
        trainingId: 'trn-1',
        authorName: 'Ana',
        content: 'Travei no passo 3',
        adminReply: null,
        createdAt: '2026-09-01T12:00:00.000Z',
      });

      await controller.addComment(ANA, 'trn-1', {
        content: 'Travei no passo 3',
      });

      expect(service.addComment).toHaveBeenCalledWith('ana', 'trn-1', {
        content: 'Travei no passo 3',
      });
    });

    it('deixa o 403 do Dev Tier subir', async () => {
      service.addComment.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.addComment(ANA, 'trn-1', { content: 'Oi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deixa o 404 de treinamento inexistente subir', async () => {
      service.addComment.mockRejectedValue(new NotFoundException());

      await expect(
        controller.addComment(ANA, 'fantasma', { content: 'Oi' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
