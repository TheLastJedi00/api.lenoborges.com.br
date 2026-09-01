import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminTrainingController } from './admin-training.controller';
import { TrainingService } from './training.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';

const ADMIN = {
  id: 'leno',
  email: 'leno@exemplo.com',
  role: 'admin',
} as CurrentUserData;

describe('AdminTrainingController', () => {
  let service: {
    listByBadgeForAdmin: jest.Mock;
    createTraining: jest.Mock;
    updateTraining: jest.Mock;
    removeTraining: jest.Mock;
    reorder: jest.Mock;
    listRecentComments: jest.Mock;
    replyComment: jest.Mock;
  };
  let controller: AdminTrainingController;

  beforeEach(() => {
    service = {
      listByBadgeForAdmin: jest.fn(),
      createTraining: jest.fn(),
      updateTraining: jest.fn(),
      removeTraining: jest.fn(),
      reorder: jest.fn(),
      listRecentComments: jest.fn(),
      replyComment: jest.fn(),
    };

    controller = new AdminTrainingController(
      service as unknown as TrainingService,
    );
  });

  /**
   * O `AdminGuard` está no controller inteiro, e não rota a rota.
   *
   * É o que impede a próxima rota de nascer aberta por esquecimento de um
   * decorador -- e um `403` de membro comum é responsabilidade do guard, e não
   * de um `if` dentro de cada método.
   */
  it('exige admin no controller inteiro', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      AdminTrainingController,
    ) as unknown[];

    expect(guards).toContain(AdminGuard);
  });

  describe('o CRUD', () => {
    it('cria na insígnia da URL', async () => {
      const dto = {
        title: 'Refatore o laço',
        description: 'Descrição',
        steps: ['Passo um'],
      };
      service.createTraining.mockResolvedValue({ id: 'trn-1' });

      await controller.create('logica', dto);

      expect(service.createTraining).toHaveBeenCalledWith('logica', dto);
    });

    it('deixa o 404 de insígnia inexistente subir', async () => {
      service.createTraining.mockRejectedValue(new NotFoundException());

      await expect(
        controller.create('nao-existe', {
          title: 'x',
          description: 'y',
          steps: ['z'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('edita pelo id', async () => {
      service.updateTraining.mockResolvedValue({ id: 'trn-1' });

      await controller.update('trn-1', { title: 'Novo' });

      expect(service.updateTraining).toHaveBeenCalledWith('trn-1', {
        title: 'Novo',
      });
    });

    it('exclui pelo id, e a cascata é problema do service', async () => {
      service.removeTraining.mockResolvedValue(undefined);

      await controller.remove('trn-1');

      expect(service.removeTraining).toHaveBeenCalledWith('trn-1');
    });

    it('deixa o 404 da exclusão de um desafio inexistente subir', async () => {
      service.removeTraining.mockRejectedValue(new NotFoundException());

      await expect(controller.remove('fantasma')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('a reordenação', () => {
    it('passa a lista inteira de ids na ordem nova', async () => {
      service.reorder.mockResolvedValue(undefined);

      await controller.reorder('logica', { orderedIds: ['b', 'a'] });

      expect(service.reorder).toHaveBeenCalledWith('logica', {
        orderedIds: ['b', 'a'],
      });
    });

    /**
     * A ordem que não bate é 400, e não uma escrita parcial.
     *
     * O service confere o conjunto antes de qualquer escrita. Deixar passar
     * gravaria posições sobre uma lista que já mudou embaixo do admin.
     */
    it('deixa o 400 da ordem que não bate subir', async () => {
      service.reorder.mockRejectedValue(new BadRequestException());

      await expect(
        controller.reorder('logica', { orderedIds: ['a'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('o painel de comentários', () => {
    it('lista os mais recentes de toda a Arena', async () => {
      service.listRecentComments.mockResolvedValue({ comments: [] });

      await expect(controller.listRecentComments()).resolves.toEqual({
        comments: [],
      });
    });

    /**
     * A resposta sai em nome de **quem está logado**, e não de um nome do corpo.
     *
     * Um `authorName` vindo do cliente deixaria o painel assinar respostas com
     * qualquer nome -- e o membro leria "Leno" numa resposta que não foi dele.
     */
    it('responde em nome do admin da sessão', async () => {
      service.replyComment.mockResolvedValue({ id: 'cmt-1' });

      await controller.reply(ADMIN, 'cmt-1', { content: 'Rode npm ci antes.' });

      expect(service.replyComment).toHaveBeenCalledWith(
        'leno',
        'cmt-1',
        'Rode npm ci antes.',
      );
    });

    it('deixa o 404 de comentário inexistente subir', async () => {
      service.replyComment.mockRejectedValue(new NotFoundException());

      await expect(
        controller.reply(ADMIN, 'fantasma', { content: 'Oi' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
