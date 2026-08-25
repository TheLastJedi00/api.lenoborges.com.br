import { NotificationsService } from './notifications.service';
import { NotificationRepository } from './notification.repository';
import { NotificationReadRepository } from './notification-read.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { Notification } from './entities/notification.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repository: jest.Mocked<Partial<NotificationRepository>>;
  let reads: jest.Mocked<Partial<NotificationReadRepository>>;
  let profiles: jest.Mocked<Partial<ProfileRepository>>;

  // Relogio fixo em todos os testes: a janela e de 30 dias, e um teste que
  // dependesse da hora de execucao passaria a reprovar sozinho com o tempo.
  const agora = new Date('2026-08-25T12:00:00.000Z');
  const membroDesde = new Date('2026-01-01T00:00:00.000Z');

  function notification(over: Partial<Notification> = {}): Notification {
    return {
      id: 'video__git-github__abc',
      kind: 'video',
      title: 'Rebase sem medo',
      badgeId: 'git-github',
      actorUid: 'admin-1',
      targetId: 'abc',
      createdAt: new Date('2026-08-20T12:00:00.000Z'),
      ...over,
    };
  }

  beforeEach(() => {
    repository = {
      listWindow: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(undefined),
      deleteForQuestion: jest.fn().mockResolvedValue(undefined),
    };

    reads = {
      findMyReads: jest.fn().mockResolvedValue(new Set<string>()),
      markRead: jest.fn().mockResolvedValue(undefined),
      markAllRead: jest.fn().mockResolvedValue(undefined),
    };

    profiles = {
      findById: jest.fn().mockResolvedValue({
        found: true,
        entry: { id: 'uid-1', createdAt: membroDesde },
      }),
    };

    service = new NotificationsService(
      repository as NotificationRepository,
      reads as NotificationReadRepository,
      profiles as ProfileRepository,
    );
  });

  it('devolve a janela em DTO, com a data em ISO', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([notification()]);

    const list = await service.listUnread('uid-1', agora);

    expect(list).toEqual([
      {
        id: 'video__git-github__abc',
        kind: 'video',
        title: 'Rebase sem medo',
        badgeId: 'git-github',
        createdAt: '2026-08-20T12:00:00.000Z',
      },
    ]);
  });

  /**
   * Sem isto, o membro escreve a pergunta dele e o sino toca por causa dela --
   * e o primeiro uso de quase todo mundo e escrever.
   */
  it('nao notifica ninguem do proprio evento', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({ id: 'a', actorUid: 'uid-1' }),
      notification({ id: 'b', actorUid: 'outro' }),
    ]);

    const list = await service.listUnread('uid-1', agora);

    expect(list.map((item) => item.id)).toEqual(['b']);
  });

  /**
   * Membro novo abrindo o painel com 50 notificacoes nao recebe um resumo do
   * produto: recebe uma pilha, e aprende a limpa-la sem ler.
   */
  it('esconde o que e anterior a entrada do membro', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({
        id: 'velha',
        createdAt: new Date('2025-12-31T00:00:00Z'),
      }),
      notification({ id: 'nova', createdAt: new Date('2026-01-15T00:00:00Z') }),
    ]);

    // Relogio de janeiro: as duas cabem na janela de 30 dias, e o unico corte
    // em jogo e o da entrada do membro.
    const list = await service.listUnread(
      'uid-1',
      new Date('2026-01-20T00:00:00Z'),
    );

    expect(list.map((item) => item.id)).toEqual(['nova']);
  });

  it('esconde o que ja foi lido', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({ id: 'lida' }),
      notification({ id: 'nao-lida' }),
    ]);
    (reads.findMyReads as jest.Mock).mockResolvedValue(new Set(['lida']));

    const list = await service.listUnread('uid-1', agora);

    expect(list.map((item) => item.id)).toEqual(['nao-lida']);
  });

  /**
   * A janela e de 30 dias. O que passa disso nao e apagado -- so para de ser
   * lido, o que mantem a leitura barata sem inventar um job de limpeza.
   */
  it('esconde o que passou da janela de 30 dias', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({
        id: 'antiga',
        createdAt: new Date('2026-07-01T12:00:00Z'),
      }),
      notification({
        id: 'recente',
        createdAt: new Date('2026-08-24T12:00:00Z'),
      }),
    ]);

    const list = await service.listUnread('uid-1', agora);

    expect(list.map((item) => item.id)).toEqual(['recente']);
  });

  it('so consulta a leitura das que sobreviveram aos cortes', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({ id: 'minha', actorUid: 'uid-1' }),
      notification({ id: 'dele', actorUid: 'outro' }),
    ]);

    await service.listUnread('uid-1', agora);

    expect(reads.findMyReads).toHaveBeenCalledWith(['dele'], 'uid-1');
  });

  it('perfil que nao existe nao derruba a listagem', async () => {
    (profiles.findById as jest.Mock).mockResolvedValue({
      found: false,
      entry: null,
    });
    (repository.listWindow as jest.Mock).mockResolvedValue([notification()]);

    await expect(service.listUnread('uid-1', agora)).resolves.toHaveLength(1);
  });

  it('marca uma como lida', async () => {
    await service.markRead('uid-1', 'video__git-github__abc');

    expect(reads.markRead).toHaveBeenCalledWith(
      'uid-1',
      'video__git-github__abc',
    );
  });

  it('marcar todas marca exatamente o que estava na lista da pessoa', async () => {
    (repository.listWindow as jest.Mock).mockResolvedValue([
      notification({ id: 'a', actorUid: 'outro' }),
      notification({ id: 'b', actorUid: 'uid-1' }),
    ]);

    await service.markAllRead('uid-1', agora);

    expect(reads.markAllRead).toHaveBeenCalledWith('uid-1', ['a']);
  });

  describe('notify', () => {
    it('escreve a notificacao do video', async () => {
      await service.notifyVideo({
        badgeId: 'git-github',
        title: 'Rebase sem medo',
        youtubeId: 'abc',
        actorUid: 'admin-1',
      });

      expect(repository.create).toHaveBeenCalledWith({
        kind: 'video',
        title: 'Rebase sem medo',
        badgeId: 'git-github',
        actorUid: 'admin-1',
        targetId: 'abc',
      });
    });

    it('escreve a notificacao da pergunta', async () => {
      await service.notifyQuestion({
        badgeId: 'logica',
        title: 'O que e um laco?',
        questionId: '2026-08-23__uid-1',
        actorUid: 'uid-1',
      });

      expect(repository.create).toHaveBeenCalledWith({
        kind: 'pergunta',
        title: 'O que e um laco?',
        badgeId: 'logica',
        actorUid: 'uid-1',
        targetId: '2026-08-23__uid-1',
      });
    });

    /**
     * O conteudo e o essencial e o aviso e o acessorio. Um POST que responde 500
     * porque a notificacao falhou e uma API que perde o trabalho do admin por
     * causa de um aviso.
     */
    it('falha ao notificar nao sobe como erro', async () => {
      (repository.create as jest.Mock).mockRejectedValue(new Error('offline'));

      await expect(
        service.notifyVideo({
          badgeId: 'git-github',
          title: 'Rebase sem medo',
          youtubeId: 'abc',
          actorUid: 'admin-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('falha ao apagar a notificacao da pergunta moderada nao sobe como erro', async () => {
      (repository.deleteForQuestion as jest.Mock).mockRejectedValue(
        new Error('offline'),
      );

      await expect(
        service.forgetQuestion('2026-08-23__uid-1'),
      ).resolves.toBeUndefined();
    });
  });
});
