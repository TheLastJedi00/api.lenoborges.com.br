import { BadgeVideoRepository } from './badge-video.repository';
import { FirebaseService } from '../auth/firebase.service';

function snapshotOf(videos: { id: string; order: number }[]) {
  return {
    docs: videos.map((video) => ({
      id: video.id,
      data: () => ({ id: video.id, order: video.order }),
    })),
  };
}

describe('BadgeVideoRepository', () => {
  let repository: BadgeVideoRepository;
  let doc: jest.Mock;
  let where: jest.Mock;
  let orderBy: jest.Mock;
  let get: jest.Mock;
  let create: jest.Mock;
  let batchUpdate: jest.Mock;
  let batchCommit: jest.Mock;

  beforeEach(() => {
    get = jest.fn().mockResolvedValue(snapshotOf([]));
    orderBy = jest.fn().mockReturnValue({ get });
    where = jest.fn().mockReturnValue({ orderBy });
    create = jest.fn().mockResolvedValue(undefined);
    doc = jest.fn().mockReturnValue({
      create,
      get: jest.fn().mockResolvedValue({ exists: false }),
      update: jest.fn(),
      delete: jest.fn(),
    });
    batchUpdate = jest.fn();
    batchCommit = jest.fn().mockResolvedValue(undefined);

    const firestore = {
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc, where }),
      }),
      batch: jest
        .fn()
        .mockReturnValue({ update: batchUpdate, commit: batchCommit }),
    };

    repository = new BadgeVideoRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  // A ordem e dado, e quem ordena e o servidor. Ordenar no service depois de ler
  // faria a lista depender de quem a leu.
  it('lista por insignia ordenando por order no proprio Firestore', async () => {
    await repository.listByBadge('logica');

    expect(where).toHaveBeenCalledWith('badgeId', '==', 'logica');
    expect(orderBy).toHaveBeenCalledWith('order');
  });

  // create(), nunca set(): e o ALREADY_EXISTS que faz o caminho composto valer
  // como a unicidade que ele promete. set() sobrescreveria em silencio.
  it('cria com create() no caminho composto badgeId__youtubeId', async () => {
    await repository.create({
      badgeId: 'logica',
      title: 'Variáveis na prática',
      description: null,
      youtubeId: 'dQw4w9WgXcQ',
      order: 0,
    });

    expect(doc).toHaveBeenCalledWith('logica__dQw4w9WgXcQ');
    expect(create).toHaveBeenCalled();
  });

  /**
   * Reordenar tem de ser atomico. Um PATCH por video movido deixa a lista com
   * dois videos no order 3 se a segunda requisicao falhar, e essa lista fica
   * errada em silencio, sem ninguem para conserta-la.
   */
  it('reordena tudo num WriteBatch unico, com posicoes 0..n-1', async () => {
    await repository.reorder(['video-c', 'video-a', 'video-b']);

    expect(batchUpdate).toHaveBeenCalledTimes(3);

    const positions = (
      batchUpdate.mock.calls as [unknown, { order: number }][]
    ).map(([, patch]) => patch.order);
    expect(positions).toEqual([0, 1, 2]);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('devolve o contrato { found, entry } quando o video nao existe', async () => {
    await expect(repository.findById('logica__inexistente')).resolves.toEqual({
      found: false,
      entry: null,
    });
  });
});
