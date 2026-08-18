import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BadgeVideoService } from './badge-video.service';
import { BadgeVideoRepository } from './badge-video.repository';
import { BadgeVideo } from './entities/badge-video.entity';

function video(id: string, order: number): BadgeVideo {
  return {
    id,
    badgeId: 'logica',
    title: `Video ${id}`,
    description: null,
    youtubeId: id.split('__')[1] ?? 'dQw4w9WgXcQ',
    order,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('BadgeVideoService', () => {
  let service: BadgeVideoService;
  let repository: jest.Mocked<
    Pick<
      BadgeVideoRepository,
      'listByBadge' | 'findById' | 'create' | 'update' | 'delete' | 'reorder'
    >
  >;

  beforeEach(() => {
    repository = {
      listByBadge: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ found: false, entry: null }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      reorder: jest.fn().mockResolvedValue(undefined),
    };

    service = new BadgeVideoService(
      repository as unknown as BadgeVideoRepository,
    );
  });

  describe('listagem', () => {
    /**
     * A trilha nao e presa: o aluno escolhe qual insignia quer conquistar e pode
     * pular. Insignia vazia e o estado NORMAL do produto -- no lancamento, onze
     * das treze estarao assim -- e por isso e 200, nao 404.
     */
    it('devolve lista vazia sem erro para insignia sem conteudo', async () => {
      await expect(service.listByBadge('angular')).resolves.toEqual({
        badgeId: 'angular',
        videos: [],
      });
    });

    // 404 aqui significa "essa insignia nao existe", que e bug ou URL adulterada.
    it('recusa badgeId que nao e da trilha', async () => {
      await expect(service.listByBadge('insignia-inventada')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('criacao', () => {
    it('grava o youtubeId extraido da URL colada', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });

      await service.create('logica', {
        title: 'Variáveis na prática',
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ youtubeId: 'dQw4w9WgXcQ' }),
      );
    });

    // ID invalido gravado vira um player quebrado na trilha, e o defeito so
    // aparece quando um aluno abre a insignia.
    it('recusa URL que nao e do YouTube', async () => {
      await expect(
        service.create('logica', {
          title: 'Um título válido',
          youtubeUrl: 'https://vimeo.com/123456',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa badgeId que nao e da trilha', async () => {
      await expect(
        service.create('nao-existe', {
          title: 'Um título válido',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // O ALREADY_EXISTS vem do caminho composto badgeId__youtubeId, que e a
    // unicidade que o Firestore nao tem como constraint.
    it('traduz ALREADY_EXISTS em 409', async () => {
      repository.create.mockRejectedValue(
        Object.assign(new Error('already exists'), { code: 6 }),
      );

      await expect(
        service.create('logica', {
          title: 'Um título válido',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('entra no fim da ordem existente', async () => {
      repository.listByBadge.mockResolvedValue([
        video('logica__aaaaaaaaaaa', 0),
        video('logica__bbbbbbbbbbb', 1),
      ]);
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 2),
      });

      await service.create('logica', {
        title: 'Um título válido',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ order: 2 }),
      );
    });
  });

  describe('reordenacao', () => {
    beforeEach(() => {
      repository.listByBadge.mockResolvedValue([
        video('logica__aaaaaaaaaaa', 0),
        video('logica__bbbbbbbbbbb', 1),
        video('logica__ccccccccccc', 2),
      ]);
    });

    it('grava a ordem recebida quando o conjunto bate', async () => {
      await service.reorder('logica', {
        videoIds: [
          'logica__ccccccccccc',
          'logica__aaaaaaaaaaa',
          'logica__bbbbbbbbbbb',
        ],
      });

      expect(repository.reorder).toHaveBeenCalledWith([
        'logica__ccccccccccc',
        'logica__aaaaaaaaaaa',
        'logica__bbbbbbbbbbb',
      ]);
    });

    // Reordenar nao pode criar nem apagar. Os tres casos abaixo sao as tres
    // formas de a lista chegar diferente do que existe.
    it('recusa lista com id faltando', async () => {
      await expect(
        service.reorder('logica', {
          videoIds: ['logica__ccccccccccc', 'logica__aaaaaaaaaaa'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa lista com id que nao e da insignia', async () => {
      await expect(
        service.reorder('logica', {
          videoIds: [
            'logica__ccccccccccc',
            'logica__aaaaaaaaaaa',
            'logica__bbbbbbbbbbb',
            'poo__zzzzzzzzzzz',
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa lista com id repetido', async () => {
      await expect(
        service.reorder('logica', {
          videoIds: [
            'logica__aaaaaaaaaaa',
            'logica__aaaaaaaaaaa',
            'logica__bbbbbbbbbbb',
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remocao', () => {
    /**
     * Este e o caso que ninguem lembra de testar, e o que deixa buraco na
     * sequencia: apagar o do meio sem renormalizar deixa a insignia com as
     * posicoes 0 e 2.
     */
    it('renormaliza a ordem depois de apagar o video do meio', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: video('logica__bbbbbbbbbbb', 1),
      });
      repository.listByBadge.mockResolvedValue([
        video('logica__aaaaaaaaaaa', 0),
        video('logica__ccccccccccc', 2),
      ]);

      await service.remove('logica', 'logica__bbbbbbbbbbb');

      expect(repository.delete).toHaveBeenCalledWith('logica__bbbbbbbbbbb');
      expect(repository.reorder).toHaveBeenCalledWith([
        'logica__aaaaaaaaaaa',
        'logica__ccccccccccc',
      ]);
    });

    it('recusa remover video que nao existe', async () => {
      await expect(
        service.remove('logica', 'logica__inexistente'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
