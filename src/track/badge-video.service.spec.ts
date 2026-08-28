import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BadgeVideoService } from './badge-video.service';
import { BadgeVideoRepository } from './badge-video.repository';
import { CreateBadgeVideoDto } from './dto/create-badge-video.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailCampaignService } from '../emails/email-campaign.service';
import { ConfigService } from '@nestjs/config';
import {
  BadgeVideo,
  BadgeVideoKind,
  BadgeVideoTab,
} from './entities/badge-video.entity';
import { MuralRepository } from '../mural/mural.repository';
import { WatchedVideoRepository } from './watched-video.repository';
import { MuralQuestion } from '../mural/entities/mural-question.entity';

/**
 * Um video de fixture.
 *
 * `tab` cai em `kind` quando nao e dito, que e o padrao do produto: uma aula
 * vive na trilha e uma resposta vive na aba de respostas. Os dois so divergem
 * quando o teste diz que divergem -- e e o caso da spec 021.
 */
function video(
  id: string,
  order: number,
  kind: BadgeVideoKind = 'aula',
  tab: BadgeVideoTab = kind,
): BadgeVideo {
  return {
    id,
    badgeId: 'logica',
    title: `Video ${id}`,
    description: null,
    youtubeId: id.split('__')[1] ?? 'dQw4w9WgXcQ',
    kind,
    tab,
    questionId: null,
    question: null,
    devTierFree: false,
    order,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** A pergunta que o mock do mural devolve. Uma so, e sempre a mesma. */
const PERGUNTA: MuralQuestion = {
  id: '2026-08-09__uid-1',
  weekId: '2026-08-09',
  badgeId: 'poo',
  authorUid: 'uid-1',
  authorName: 'Ana Prado',
  title: 'Quando usar herança em vez de composição?',
  body: null,
  voteCount: 12,
  answerVideoId: null,
  promotedTo: null,
  createdAt: new Date('2026-08-09T18:00:00.000Z'),
  updatedAt: new Date('2026-08-09T18:00:00.000Z'),
};

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
  let mural: jest.Mocked<Pick<MuralRepository, 'findById' | 'update'>>;
  let watchedVideos: jest.Mocked<
    Pick<WatchedVideoRepository, 'findWatchedIds'>
  >;

  beforeEach(() => {
    mural = {
      findById: jest.fn().mockResolvedValue({ found: true, entry: PERGUNTA }),
      update: jest.fn().mockResolvedValue({ entry: PERGUNTA }),
    };

    watchedVideos = {
      findWatchedIds: jest.fn().mockResolvedValue(new Set<string>()),
    };

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
      mural as unknown as MuralRepository,
      watchedVideos as unknown as WatchedVideoRepository,
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
          tab: 'aula',
          questionId: null,
          question: null,
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
      await expect(
        service.listByBadge('angular', 'uid-de-quem-pediu'),
      ).resolves.toEqual({
        badgeId: 'angular',
        videos: [],
      });
    });

    it('marca como assistido o que o razao daquele membro diz', async () => {
      repository.listByBadge.mockResolvedValue([
        video('logica__aaa11111111', 0),
        video('logica__bbb22222222', 1),
      ]);
      watchedVideos.findWatchedIds.mockResolvedValue(
        new Set(['logica__aaa11111111']),
      );

      const lista = await service.listByBadge('logica', 'uid-1');

      expect(lista.videos.map((v) => [v.id, v.watched])).toEqual([
        ['logica__aaa11111111', true],
        ['logica__bbb22222222', false],
      ]);
    });

    /**
     * **A lista deixou de ser igual para todo mundo** (spec 019). E barato, e
     * obvio, e e o erro que um cache de listagem mal colocado produz sem falhar
     * em nada: o check de uma pessoa servido para outra.
     */
    it('teste-trava: o razao consultado e o de quem pediu a lista', async () => {
      repository.listByBadge.mockResolvedValue([
        video('logica__aaa11111111', 0),
      ]);

      await service.listByBadge('logica', 'uid-1');
      await service.listByBadge('logica', 'uid-2');

      expect(watchedVideos.findWatchedIds).toHaveBeenNthCalledWith(1, 'uid-1', [
        'logica__aaa11111111',
      ]);
      expect(watchedVideos.findWatchedIds).toHaveBeenNthCalledWith(2, 'uid-2', [
        'logica__aaa11111111',
      ]);
    });

    /** Video sem registro e `false`. Nao existe "nao sei" nesta resposta. */
    it('video sem registro no razao sai como nao assistido', async () => {
      repository.listByBadge.mockResolvedValue([
        video('logica__aaa11111111', 0),
      ]);

      const lista = await service.listByBadge('logica', 'uid-1');

      expect(lista.videos[0].watched).toBe(false);
    });

    // 404 aqui significa "essa insignia nao existe", que e bug ou URL adulterada.
    it('recusa badgeId que nao e da trilha', async () => {
      await expect(
        service.listByBadge('insignia-inventada', 'uid-de-quem-pediu'),
      ).rejects.toThrow(NotFoundException);
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

    /**
     * A outra metade da simetria, que a spec 010 declarou em comentario e nao
     * implementou. A janela para apertar isto e agora: nenhum video `resposta`
     * foi publicado ate hoje, porque o formulario do front nunca mandou `kind`.
     *
     * E agora ha consequencia visivel: resposta sem pergunta e um video que a
     * trilha desenha com um balao vazio em cima.
     */
    it('recusa resposta sem pergunta', async () => {
      await expect(
        service.create(
          'logica',
          {
            title: 'Uma resposta orfa',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            kind: 'resposta',
          },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('recusa pergunta que nao existe, e nao grava nada', async () => {
      mural.findById.mockResolvedValue({ found: false, entry: null });

      await expect(
        service.create(
          'logica',
          {
            title: 'Respondendo o vento',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            kind: 'resposta',
            questionId: 'nao-existe',
          },
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);

      // O video nao pode nascer com um vinculo para lugar nenhum: o sintoma so
      // apareceria na tela do aluno, com um balao vazio.
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('grava a foto da pergunta: titulo, autor e a data de quando foi perguntada', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      await service.create(
        'logica',
        {
          title: 'Herança e composição, na prática',
          youtubeUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        },
        'admin-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          question: {
            id: '2026-08-09__uid-1',
            title: 'Quando usar herança em vez de composição?',
            authorName: 'Ana Prado',
            // A data e a da PERGUNTA, e nunca a do video.
            askedAt: new Date('2026-08-09T18:00:00.000Z'),
          },
        }),
      );
    });

    /**
     * **Teste-trava da decisao 3.** A foto e foto: editar a pergunta depois nao
     * mexe no video, e e por isso que ela e uma copia e nao uma juncao.
     */
    it('teste-trava: editar a pergunta depois nao muda a foto ja gravada', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      await service.create(
        'logica',
        {
          title: 'Herança e composição, na prática',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        },
        'admin-1',
      );

      const [gravado] = repository.create.mock.calls[0];

      // A pergunta muda no mural, depois da publicacao.
      mural.findById.mockResolvedValue({
        found: true,
        entry: { ...PERGUNTA, title: 'Outro titulo', authorName: 'Outro nome' },
      });

      expect(gravado.question).toEqual(
        expect.objectContaining({
          title: 'Quando usar herança em vez de composição?',
          authorName: 'Ana Prado',
        }),
      );
    });

    /**
     * **Teste-trava da decisao 6.** A insignia da pergunta e o palpite de quem
     * perguntou, e quem perguntou frequentemente erra: uma duvida sobre
     * `async/await` marcada como Logica e uma duvida sobre JavaScript. O video
     * mora onde ele ensina.
     *
     * Existe para impedir que alguem "conserte" isto com uma validacao a mais.
     */
    it('teste-trava: a insignia do video pode ser diferente da insignia da pergunta', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      // A pergunta e de `poo`, e o video entra em `logica`.
      await expect(
        service.create(
          'logica',
          {
            title: 'Herança e composição, na prática',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            kind: 'resposta',
            questionId: '2026-08-09__uid-1',
          },
          'admin-1',
        ),
      ).resolves.toEqual(expect.objectContaining({ badgeId: 'logica' }));
    });

    it('a resposta sai da API em retrato, e a aula em paisagem', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      const resposta = await service.create(
        'logica',
        {
          title: 'Herança e composição, na prática',
          youtubeUrl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        },
        'admin-1',
      );

      expect(resposta.orientation).toBe('retrato');

      repository.create.mockResolvedValue({
        entry: video('logica__aBcDeFgHiJk', 1),
      });

      const aula = await service.create(
        'logica',
        {
          title: 'Uma aula comum',
          youtubeUrl: 'https://youtu.be/aBcDeFgHiJk',
        },
        'admin-1',
      );

      expect(aula.orientation).toBe('paisagem');
    });

    it('publicar a resposta fecha o answerVideoId da pergunta', async () => {
      repository.create.mockResolvedValue({
        entry: {
          ...video('logica__dQw4w9WgXcQ', 0, 'resposta'),
          questionId: '2026-08-09__uid-1',
        },
      });

      await service.create(
        'logica',
        {
          title: 'Herança e composição, na prática',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          kind: 'resposta',
          questionId: '2026-08-09__uid-1',
        },
        'admin-1',
      );

      expect(mural.update).toHaveBeenCalledWith('2026-08-09__uid-1', {
        answerVideoId: 'logica__dQw4w9WgXcQ',
      });
    });

    /**
     * **Teste-trava da decisao 7.** O vinculo e o lado barato de falhar: quando
     * ele roda, o video ja esta no ar, e o balao do aluno vem da foto e nao
     * daqui. Um 500 aqui perderia o trabalho do admin por causa de um ponteiro.
     */
    it('teste-trava: o vinculo falhando nao derruba a publicacao', async () => {
      repository.create.mockResolvedValue({
        entry: {
          ...video('logica__dQw4w9WgXcQ', 0, 'resposta'),
          questionId: '2026-08-09__uid-1',
        },
      });
      mural.update.mockRejectedValue(new Error('firestore fora do ar'));

      await expect(
        service.create(
          'logica',
          {
            title: 'Herança e composição, na prática',
            youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
            kind: 'resposta',
            questionId: '2026-08-09__uid-1',
          },
          'admin-1',
        ),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'logica__dQw4w9WgXcQ' }),
      );
    });

    it('publicar aula nao escreve nada no mural', async () => {
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

      expect(mural.update).not.toHaveBeenCalled();
    });

    it('aula nao le o mural e nasce sem foto', async () => {
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

      expect(mural.findById).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ question: null }),
      );
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

  /**
   * A aba de destino (spec 021).
   *
   * `kind` e a natureza do video e `tab` e a lista em que ele vive. Os dois
   * divergem em exatamente um caso -- a resposta posicionada na trilha -- e e
   * esse caso que a spec inteira existe para permitir.
   */
  describe('a aba de destino (spec 021)', () => {
    function publicar(dto: Partial<CreateBadgeVideoDto>) {
      return service.create(
        'logica',
        {
          title: 'Herança e composição, na prática',
          youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
          ...dto,
        } as CreateBadgeVideoDto,
        'admin-1',
      );
    }

    /**
     * **O caso que a spec existe para permitir.** Vem primeiro de proposito: um
     * teste que so cobrisse o 400 deixaria alguem "endurecer" a validacao para
     * exigir `tab === kind` e matar a funcionalidade sem quebrar nada.
     */
    it('aceita resposta com tab de aula, e grava a resposta na trilha', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta', 'aula'),
      });

      await publicar({ kind: 'resposta', questionId: '2026-08-09__uid-1', tab: 'aula' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'resposta', tab: 'aula' }),
      );
    });

    /**
     * **O terceiro estado incoerente da familia que a spec 017 abriu** --
     * resposta sem pergunta e aula com pergunta sao os outros dois. A aba de
     * respostas e a lista das perguntas respondidas; uma aula ali e um video sem
     * balao numa lista de baloes.
     */
    it('recusa aula na aba de respostas, e nao grava nada', async () => {
      await expect(publicar({ kind: 'aula', tab: 'resposta' })).rejects.toThrow(
        BadRequestException,
      );

      expect(repository.create).not.toHaveBeenCalled();
    });

    // Sem `tab` no corpo o servidor deriva, e o cliente que nao conhece esta
    // spec continua funcionando sem enviar nada. E o que permite subir a API
    // antes do front.
    it('deriva tab do kind quando o corpo nao manda tab', async () => {
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0),
      });

      await publicar({});

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'aula', tab: 'aula' }),
      );

      repository.create.mockClear();
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 0, 'resposta'),
      });

      await publicar({ kind: 'resposta', questionId: '2026-08-09__uid-1' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'resposta', tab: 'resposta' }),
      );
    });

    /**
     * **O bug mais provavel desta fase, e ele nao estoura.** Contar pela lista
     * do `kind` poria a resposta em `order: 1` -- a posicao dela na aba de
     * respostas -- dentro de uma trilha que ja tem tres aulas. Dois videos com o
     * mesmo `order` na mesma lista ordenam por sorte do Firestore, e a trilha
     * embaralha em silencio.
     */
    it('teste-trava: o novo video entra no fim da lista do tab, e nao da do kind', async () => {
      // Tres aulas na trilha, uma resposta na aba. A resposta nova vai para a
      // trilha, entao a unica contagem certa e a das tres aulas.
      repository.listByBadge.mockImplementation((_badgeId, tab) =>
        Promise.resolve(
          tab === 'aula'
            ? [video('logica__a', 0), video('logica__b', 1), video('logica__c', 2)]
            : [video('logica__r', 0, 'resposta')],
        ),
      );
      repository.create.mockResolvedValue({
        entry: video('logica__dQw4w9WgXcQ', 3, 'resposta', 'aula'),
      });

      await publicar({ kind: 'resposta', questionId: '2026-08-09__uid-1', tab: 'aula' });

      expect(repository.listByBadge).toHaveBeenCalledWith('logica', 'aula');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ order: 3 }),
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
