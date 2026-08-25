import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BadgeVideoService } from './badge-video.service';
import { BadgeVideoRepository } from './badge-video.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailCampaignService } from '../emails/email-campaign.service';
import { ConfigService } from '@nestjs/config';
import { BadgeVideo, BadgeVideoKind } from './entities/badge-video.entity';

function video(
  id: string,
  order: number,
  kind: BadgeVideoKind = 'aula',
): BadgeVideo {
  return {
    id,
    badgeId: 'logica',
    title: `Video ${id}`,
    description: null,
    youtubeId: id.split('__')[1] ?? 'dQw4w9WgXcQ',
    kind,
    questionId: null,
    devTierFree: false,
    order,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('BadgeVideoService', () => {
  let service: BadgeVideoService;
  let notifications: jest.Mocked<Pick<NotificationsService, 'notifyVideo'>>;
  let campaigns: { createAndSend: jest.Mock };
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

    notifications = {
      notifyVideo: jest.fn().mockResolvedValue(undefined),
    };

    campaigns = {
      createAndSend: jest.fn().mockResolvedValue({
        id: 'camp-1',
        status: 'concluida',
        audienceCount: 1,
        sentCount: 1,
        failedCount: 0,
      }),
    };

    service = new BadgeVideoService(
      repository as unknown as BadgeVideoRepository,
      notifications as unknown as NotificationsService,
      campaigns as unknown as EmailCampaignService,
      {
        getOrThrow: () => 'https://edu.lenoborges.com.br',
      } as unknown as ConfigService,
    );
  });

  describe('o anuncio por e-mail (spec 014)', () => {
    function publicar() {
      repository.create.mockResolvedValue({
        entry: {
          id: 'logica__dQw4w9WgXcQ',
          badgeId: 'logica',
          title: 'Variáveis, do zero',
          description: null,
          youtubeId: 'dQw4w9WgXcQ',
          kind: 'aula',
          questionId: null,
          devTierFree: false,
          order: 0,
          createdAt: new Date('2026-08-25T12:00:00.000Z'),
          updatedAt: new Date('2026-08-25T12:00:00.000Z'),
        },
      });

      return service.create(
        'logica',
        {
          title: 'Variáveis, do zero',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        },
        'admin-1',
      );
    }

    it('publicar dispara a campanha de video, com o id do caminho', async () => {
      await publicar();

      expect(campaigns.createAndSend).toHaveBeenCalledTimes(1);
      const [pedido] = campaigns.createAndSend.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(pedido.id).toBe('video__logica__dQw4w9WgXcQ');
      expect(pedido.kind).toBe('video');
      expect(pedido.subject).toContain('Variáveis, do zero');
    });

    it('quem publicou nao recebe o proprio anuncio', async () => {
      await publicar();

      const [pedido] = campaigns.createAndSend.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(pedido.excludeUid).toBe('admin-1');
    });

    it('o botao leva a trilha daquela insignia, com URL absoluta', async () => {
      // E-mail nao tem roteador: o link precisa ser inteiro.
      await publicar();

      const [pedido] = campaigns.createAndSend.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(pedido.ctaUrl).toBe(
        'https://edu.lenoborges.com.br/dashboard/trilha/logica',
      );
      expect(pedido.body).toContain('Insígnia da Lógica');
    });

    it('o anuncio sai para todo mundo: sem filtro de tier no gatilho', async () => {
      // Ponto em aberto 3 da spec: aplicar o filtro de tier aqui e uma linha de
      // codigo e uma decisao de produto, e esta escrita como "nao" por ora.
      await publicar();

      const [pedido] = campaigns.createAndSend.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(pedido.filters).toEqual({
        tiers: null,
        gradeMin: null,
        gradeMax: null,
      });
    });

    /**
     * O mesmo teste que a spec 012 escreveu para a notificação, agora com um
     * segundo efeito colateral bem mais caro: N/100 requisições HTTP para fora.
     */
    it('teste-trava: e-mail falhando, o video continua criado e a resposta e a mesma', async () => {
      campaigns.createAndSend.mockRejectedValue(
        new Error('provedor fora do ar'),
      );

      await expect(publicar()).resolves.toMatchObject({
        id: 'logica__dQw4w9WgXcQ',
        badgeId: 'logica',
      });
    });

    it('teste-trava: notificacao falhando tambem nao derruba o e-mail', async () => {
      // As duas garantias sao independentes: cada uma tem o proprio catch.
      notifications.notifyVideo.mockRejectedValue(new Error('offline'));

      await expect(publicar()).resolves.toBeDefined();
      expect(campaigns.createAndSend).toHaveBeenCalledTimes(1);
    });
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

      await service.create(
        'logica',
        {
          title: 'Variáveis na prática',
          youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
        },
        'admin-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ youtubeId: 'dQw4w9WgXcQ' }),
      );
    });

    // ID invalido gravado vira um player quebrado na trilha, e o defeito so
    // aparece quando um aluno abre a insignia.
    it('recusa URL que nao e do YouTube', async () => {
      await expect(
        service.create(
          'logica',
          {
            title: 'Um título válido',
            youtubeUrl: 'https://vimeo.com/123456',
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa badgeId que nao e da trilha', async () => {
      await expect(
        service.create(
          'nao-existe',
          {
            title: 'Um título válido',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // O ALREADY_EXISTS vem do caminho composto badgeId__youtubeId, que e a
    // unicidade que o Firestore nao tem como constraint.
    it('traduz ALREADY_EXISTS em 409', async () => {
      repository.create.mockRejectedValue(
        Object.assign(new Error('already exists'), { code: 6 }),
      );

      await expect(
        service.create(
          'logica',
          {
            title: 'Um título válido',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          },
          'admin-1',
        ),
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

      await service.create(
        'logica',
        {
          title: 'Um título válido',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        },
        'admin-1',
      );

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

    /**
     * **O bug mais provavel da spec 010, e a razao deste teste existir.**
     *
     * A ordem e por `(badgeId, kind)`: uma insignia com tres aulas e duas
     * respostas tem duas sequencias independentes. Reordenar sem filtrar por
     * `kind` embaralharia as duas abas de uma vez, e a que ninguem tocou
     * apareceria fora de ordem sem explicacao.
     */
    it('reordena dentro da aba, sem enxergar a outra', async () => {
      const aulas = [
        video('logica__aaaaaaaaaaa', 0),
        video('logica__bbbbbbbbbbb', 1),
      ];
      const respostas = [video('logica__rrrrrrrrrrr', 0, 'resposta')];

      repository.listByBadge.mockImplementation((_badge, kind) =>
        Promise.resolve(kind === 'resposta' ? respostas : aulas),
      );

      await service.reorder(
        'logica',
        { videoIds: ['logica__rrrrrrrrrrr'] },
        'resposta',
      );

      expect(repository.listByBadge).toHaveBeenCalledWith('logica', 'resposta');
      expect(repository.reorder).toHaveBeenCalledWith(['logica__rrrrrrrrrrr']);
    });

    it('recusa misturar ids de abas diferentes', async () => {
      const aulas = [video('logica__aaaaaaaaaaa', 0)];
      const respostas = [video('logica__rrrrrrrrrrr', 0, 'resposta')];

      repository.listByBadge.mockImplementation((_badge, kind) =>
        Promise.resolve(kind === 'resposta' ? respostas : aulas),
      );

      await expect(
        service.reorder(
          'logica',
          { videoIds: ['logica__rrrrrrrrrrr', 'logica__aaaaaaaaaaa'] },
          'resposta',
        ),
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

    // Apagar uma resposta renormaliza a aba de respostas, e nao a de aulas.
    it('renormaliza so a aba do video removido', async () => {
      repository.findById.mockResolvedValue({
        found: true,
        entry: video('logica__rrrrrrrrrrr', 0, 'resposta'),
      });
      repository.listByBadge.mockResolvedValue([]);

      await service.remove('logica', 'logica__rrrrrrrrrrr');

      expect(repository.listByBadge).toHaveBeenCalledWith('logica', 'resposta');
    });
  });

  describe('videos de resposta', () => {
    it('vincula a pergunta que originou a resposta', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      await service.create(
        'logica',
        {
          title: 'Respondendo a pergunta da semana',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        },
        'admin-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        }),
      );
    });

    /**
     * Aula com pergunta e resposta sem pergunta sao os dois estados incoerentes,
     * e o 400 e mais barato que um dado torto que ninguem sabe interpretar
     * depois.
     */
    it('recusa vincular pergunta a uma aula', async () => {
      await expect(
        service.create(
          'logica',
          {
            title: 'Uma aula comum',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            kind: 'aula',
            questionId: '2026-08-09__uid-1',
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('marca o video como livre para todos', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });

      await service.create(
        'logica',
        {
          title: 'Uma aula de vitrine',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          devTierFree: true,
        },
        'admin-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ devTierFree: true }),
      );
    });

    // Nasce como aula porque e o que quase todo video e.
    it('entra como aula quando o kind nao e informado', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });

      await service.create(
        'logica',
        {
          title: 'Uma aula comum',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        },
        'admin-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'aula', devTierFree: false }),
      );
    });
  });

  describe('notificacao (spec 012)', () => {
    it('anuncia o video publicado, com o uid de quem publicou', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });

      await service.create(
        'logica',
        {
          title: 'Variaveis na pratica',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        },
        'admin-1',
      );

      // O titulo anunciado e o que ficou GRAVADO, e nao o que veio no corpo da
      // requisicao: se o repositorio normalizar alguma coisa, o aviso conta a
      // versao que a trilha vai mostrar.
      const gravado = video('logica__dQw4w9WgXcQ', 0);

      expect(notifications.notifyVideo).toHaveBeenCalledWith({
        badgeId: 'logica',
        title: gravado.title,
        youtubeId: 'dQw4w9WgXcQ',
        actorUid: 'admin-1',
      });
    });

    /**
     * O conteudo e o essencial e o aviso e o acessorio. Um 500 aqui perderia o
     * trabalho do admin por causa de uma notificacao, e o video ja esta gravado
     * quando isto roda.
     */
    it('video continua criado e a resposta continua 201 quando notificar falha', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });
      notifications.notifyVideo.mockRejectedValue(new Error('offline'));

      await expect(
        service.create(
          'logica',
          {
            title: 'Variaveis na pratica',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          },
          'admin-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ youtubeId: 'dQw4w9WgXcQ' }));

      expect(repository.create).toHaveBeenCalled();
    });
  });
});
