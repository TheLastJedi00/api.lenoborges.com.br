import { MuralRepository } from './mural.repository';
import { FirebaseService } from '../auth/firebase.service';

describe('MuralRepository', () => {
  let repository: MuralRepository;
  let doc: jest.Mock;
  let where: jest.Mock;
  let orderBy: jest.Mock;
  let create: jest.Mock;
  let batchCreate: jest.Mock;
  let batchUpdate: jest.Mock;
  let batchDelete: jest.Mock;
  let batchCommit: jest.Mock;

  beforeEach(() => {
    const get = jest.fn().mockResolvedValue({ docs: [], empty: true });
    const limit = jest.fn().mockReturnValue({ get });
    // Encadeamento: where().orderBy().orderBy().limit().get()
    orderBy = jest.fn();
    const chain = { orderBy, limit, get };
    orderBy.mockReturnValue(chain);
    where = jest.fn().mockReturnValue(chain);

    create = jest.fn().mockResolvedValue(undefined);
    doc = jest.fn().mockReturnValue({
      create,
      get: jest.fn().mockResolvedValue({ exists: false }),
      update: jest.fn(),
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc: jest.fn() }),
        doc: jest.fn(),
        listDocuments: jest.fn().mockResolvedValue([]),
      }),
    });

    batchCreate = jest.fn();
    batchUpdate = jest.fn();
    batchDelete = jest.fn();
    batchCommit = jest.fn().mockResolvedValue(undefined);

    const firestore = {
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc, where }),
      }),
      batch: jest.fn().mockReturnValue({
        create: batchCreate,
        update: batchUpdate,
        delete: batchDelete,
        commit: batchCommit,
      }),
      getAll: jest.fn().mockResolvedValue([]),
    };

    repository = new MuralRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  it('ordena a semana em votacao por votos, com desempate pela mais antiga', async () => {
    await repository.listByWeek('2026-08-09', true);

    expect(where).toHaveBeenCalledWith('weekId', '==', '2026-08-09');
    expect(orderBy).toHaveBeenCalledWith('voteCount', 'desc');
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'asc');
  });

  // Na coleta o voto ainda nao abriu: ordenar por um contador zerado seria
  // ordenar por nada.
  it('ordena a semana em coleta por data', async () => {
    await repository.listByWeek('2026-08-16', false);

    expect(orderBy).toHaveBeenCalledWith('createdAt', 'asc');
    expect(orderBy).not.toHaveBeenCalledWith('voteCount', 'desc');
  });

  /**
   * O caminho `{weekId}__{uid}` e a garantia de uma pergunta por membro por
   * semana. `set()` sobrescreveria a anterior em silencio; e o ALREADY_EXISTS do
   * `create()` que vira o 409 da tela.
   */
  it('cria no caminho composto weekId__uid, com create()', async () => {
    await repository.create({
      weekId: '2026-08-16',
      badgeId: 'logica',
      authorUid: 'uid-1',
      authorName: 'Membro',
      title: 'Como saber quando usar herança?',
      body: null,
    });

    expect(doc).toHaveBeenCalledWith('2026-08-16__uid-1');
    expect(create).toHaveBeenCalled();
  });

  it('nasce com o contador de votos zerado', async () => {
    const { entry } = await repository.create({
      weekId: '2026-08-16',
      badgeId: 'logica',
      authorUid: 'uid-1',
      authorName: 'Membro',
      title: 'Uma pergunta qualquer',
      body: null,
    });

    expect(entry.voteCount).toBe(0);
    expect(entry.answerVideoId).toBeNull();
  });

  /**
   * As duas operacoes do voto vao no mesmo lote. Se o voto ja existe, o create()
   * falha e o lote inteiro falha junto -- o contador nao se mexe, que e a
   * protecao contra contar duas vezes.
   */
  it('vota criando o documento e incrementando o contador no mesmo lote', async () => {
    await repository.vote('2026-08-09__uid-1', 'uid-2');

    expect(batchCreate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('desfaz o voto apagando e decrementando no mesmo lote', async () => {
    await repository.unvote('2026-08-09__uid-1', 'uid-2');

    expect(batchDelete).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  /**
   * Subcolecao nao desaparece com o pai no Firestore: o documento some e os
   * votos ficam orfaos, invisiveis e cobrados. E a pegadinha classica.
   */
  it('apaga a pergunta e os votos dela no mesmo lote', async () => {
    await repository.remove('2026-08-09__uid-1');

    expect(batchDelete).toHaveBeenCalled();
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('devolve o contrato { found, entry } quando a pergunta nao existe', async () => {
    await expect(repository.findById('2026-08-16__ninguem')).resolves.toEqual({
      found: false,
      entry: null,
    });
  });

  // getAll() sem documentos estoura no Firestore, e pagina vazia e normal.
  it('nao consulta votos quando nao ha pergunta na pagina', async () => {
    await expect(repository.findMyVotes([], 'uid-1')).resolves.toEqual(
      new Set(),
    );
  });
});
