import { NotificationReadRepository } from './notification-read.repository';
import { FirebaseService } from '../auth/firebase.service';

describe('NotificationReadRepository', () => {
  let repository: NotificationReadRepository;
  let profileDoc: jest.Mock;
  let readDoc: jest.Mock;
  let set: jest.Mock;
  let getAll: jest.Mock;
  let batchSet: jest.Mock;
  let batchCommit: jest.Mock;

  beforeEach(() => {
    set = jest.fn().mockResolvedValue(undefined);
    readDoc = jest.fn((id: string) => ({ set, path: `reads/${id}` }));

    profileDoc = jest.fn().mockReturnValue({
      collection: jest.fn().mockReturnValue({ doc: readDoc }),
    });

    getAll = jest.fn().mockResolvedValue([]);
    batchSet = jest.fn();
    batchCommit = jest.fn().mockResolvedValue(undefined);

    const firestore = {
      collection: jest.fn().mockReturnValue({ doc: profileDoc }),
      getAll,
      batch: jest.fn().mockReturnValue({
        set: batchSet,
        commit: batchCommit,
      }),
    };

    repository = new NotificationReadRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  /**
   * Marcar como lida **precisa** ser idempotente: o mesmo clique pode chegar
   * duas vezes, e a segunda nao e erro. E a unica excecao a regra `create()`
   * nunca `set()` que vale no resto do projeto.
   */
  it('marca como lida com set, para a segunda vez nao ser erro', async () => {
    await repository.markRead('uid-1', 'video__git-github__abc');

    expect(profileDoc).toHaveBeenCalledWith('uid-1');
    expect(readDoc).toHaveBeenCalledWith('video__git-github__abc');
    expect(set).toHaveBeenCalled();
  });

  it('marcar duas vezes a mesma notificacao nao lanca', async () => {
    await repository.markRead('uid-1', 'video__git-github__abc');

    await expect(
      repository.markRead('uid-1', 'video__git-github__abc'),
    ).resolves.toBeUndefined();
  });

  it('marca todas num lote so, e nao uma escrita por item', async () => {
    await repository.markAllRead('uid-1', ['a', 'b', 'c']);

    expect(batchSet).toHaveBeenCalledTimes(3);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('marcar todas sem nada a marcar nao toca no Firestore', async () => {
    await repository.markAllRead('uid-1', []);

    expect(batchCommit).not.toHaveBeenCalled();
  });

  /**
   * Um `getAll` por caminho, como o `findMyVotes` do Mural. Nunca uma consulta
   * por usuario, nunca N leituras em laco.
   */
  it('descobre o que ja foi lido com um getAll por caminho', async () => {
    getAll.mockResolvedValue([{ exists: true }, { exists: false }]);

    const read = await repository.findMyReads(['a', 'b'], 'uid-1');

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(read.has('a')).toBe(true);
    expect(read.has('b')).toBe(false);
  });

  it('lista vazia nao chama o getAll', async () => {
    const read = await repository.findMyReads([], 'uid-1');

    expect(getAll).not.toHaveBeenCalled();
    expect(read.size).toBe(0);
  });
});
