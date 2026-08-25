import { NotificationRepository } from './notification.repository';
import { FirebaseService } from '../auth/firebase.service';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';

describe('NotificationRepository', () => {
  let repository: NotificationRepository;
  let doc: jest.Mock;
  let create: jest.Mock;
  let orderBy: jest.Mock;
  let limit: jest.Mock;
  let where: jest.Mock;

  beforeEach(() => {
    const get = jest.fn().mockResolvedValue({ docs: [] });
    limit = jest.fn().mockReturnValue({ get });
    orderBy = jest.fn().mockReturnValue({ limit, get });
    where = jest.fn();

    create = jest.fn().mockResolvedValue(undefined);
    doc = jest.fn().mockReturnValue({ create });

    const firestore = {
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc, orderBy, where }),
      }),
    };

    repository = new NotificationRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  /**
   * A consulta e so `orderBy('createdAt','desc').limit(50)`, que o Firestore
   * atende com o indice de campo unico que ele cria sozinho.
   *
   * O teste existe para travar isso: cada `where` combinado com o `orderBy`
   * exigiria um indice composto em producao, e o emulador nao exige indice --
   * entao a suite passaria verde e a falha so apareceria no primeiro acesso
   * real. Os cortes por autor e por data de entrada sao em memoria de proposito.
   */
  it('lista a janela sem nenhum filtro, so ordenada e limitada', async () => {
    await repository.listWindow(50);

    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limit).toHaveBeenCalledWith(50);
    expect(where).not.toHaveBeenCalled();
  });

  it('grava a notificacao no caminho que carrega o evento', async () => {
    await repository.create({
      kind: 'video',
      title: 'Rebase sem medo',
      badgeId: 'git-github',
      actorUid: 'admin-1',
      targetId: 'dQw4w9WgXcQ',
    });

    expect(doc).toHaveBeenCalledWith('video__git-github__dQw4w9WgXcQ');
    expect(create).toHaveBeenCalled();
  });

  it('a pergunta nao leva a insignia no caminho, porque o id dela ja e unico', async () => {
    await repository.create({
      kind: 'pergunta',
      title: 'Como faco rebase?',
      badgeId: 'git-github',
      actorUid: 'membro-1',
      targetId: '2026-08-23__uid-1',
    });

    expect(doc).toHaveBeenCalledWith('pergunta__2026-08-23__uid-1');
  });

  /**
   * Anunciar duas vezes e o erro; falhar a publicacao por causa disso seria
   * pior. O evento ja anunciado nao e excecao a propagar, e sim o caminho
   * fazendo o trabalho dele.
   */
  it('engole o ALREADY_EXISTS em silencio', async () => {
    create.mockRejectedValue({ code: ALREADY_EXISTS });

    await expect(
      repository.create({
        kind: 'video',
        title: 'Rebase sem medo',
        badgeId: 'git-github',
        actorUid: 'admin-1',
        targetId: 'dQw4w9WgXcQ',
      }),
    ).resolves.toBeUndefined();
  });

  it('propaga qualquer outra falha de escrita', async () => {
    create.mockRejectedValue({ code: 13, message: 'INTERNAL' });

    await expect(
      repository.create({
        kind: 'video',
        title: 'Rebase sem medo',
        badgeId: 'git-github',
        actorUid: 'admin-1',
        targetId: 'dQw4w9WgXcQ',
      }),
    ).rejects.toBeDefined();
  });

  it('apaga a notificacao de uma pergunta moderada', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    doc.mockReturnValue({ create, delete: remove });

    await repository.deleteForQuestion('2026-08-23__uid-1');

    expect(doc).toHaveBeenCalledWith('pergunta__2026-08-23__uid-1');
    expect(remove).toHaveBeenCalled();
  });
});
