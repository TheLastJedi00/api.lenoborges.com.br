import { MuralRepository } from './mural.repository';
import { ANONYMOUS_AUTHOR_UID } from './entities/mural-question.entity';
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
  let getAll: jest.Mock;
  let listDocuments: jest.Mock;
  let queryGet: jest.Mock;

  beforeEach(() => {
    queryGet = jest.fn().mockResolvedValue({ docs: [], empty: true, size: 0 });
    const get = queryGet;
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

    getAll = jest.fn().mockResolvedValue([]);
    listDocuments = jest.fn().mockResolvedValue([]);

    const firestore = {
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc, where, listDocuments }),
      }),
      batch: jest.fn().mockReturnValue({
        create: batchCreate,
        update: batchUpdate,
        delete: batchDelete,
        commit: batchCommit,
      }),
      getAll,
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

  /**
   * A pergunta do Mural nao e so de quem perguntou: tem votos de outras pessoas
   * e pode ter virado video na trilha. Entao o autor some e o texto fica.
   */
  it('anonimiza o autor sem tocar em texto, badgeId, voteCount nem answerVideoId', async () => {
    const ref = { id: '2026-08-09__uid-1' };
    queryGet.mockResolvedValue({ empty: false, size: 1, docs: [{ ref }] });

    await expect(repository.anonymizeAuthor('uid-1')).resolves.toBe(1);

    expect(where).toHaveBeenCalledWith('authorUid', '==', 'uid-1');
    const [alvo, campos] = batchUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(alvo).toBe(ref);
    expect(campos.authorUid).toBe(ANONYMOUS_AUTHOR_UID);
    expect(campos.authorName).toBe('Membro removido');
    expect(Object.keys(campos).sort()).toEqual([
      'authorName',
      'authorUid',
      'updatedAt',
    ]);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('nao abre lote quando a pessoa nunca perguntou', async () => {
    await expect(repository.anonymizeAuthor('uid-sem-pergunta')).resolves.toBe(
      0,
    );

    expect(batchCommit).not.toHaveBeenCalled();
  });

  /**
   * Contador que discorda da subcolecao e um numero que ninguem consegue
   * conferir depois: o decremento vai no mesmo lote que a remocao do voto.
   */
  it('apaga os votos dados decrementando o contador no mesmo lote', async () => {
    const perguntas = [{ id: 'q1' }, { id: 'q2' }];
    listDocuments.mockResolvedValue(
      perguntas.map((pergunta) => ({
        ...pergunta,
        collection: jest
          .fn()
          .mockReturnValue({ doc: jest.fn().mockReturnValue({}) }),
      })),
    );
    getAll.mockResolvedValue([
      { exists: true, ref: { id: 'voto-q1' } },
      { exists: false, ref: { id: 'voto-q2' } },
    ]);

    await expect(repository.removeVotesBy('uid-1')).resolves.toBe(1);

    // So a pergunta em que houve voto entra no lote: apagar e decrementar.
    expect(batchDelete).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it('nao abre lote quando a pessoa nunca votou', async () => {
    listDocuments.mockResolvedValue([
      {
        id: 'q1',
        collection: jest
          .fn()
          .mockReturnValue({ doc: jest.fn().mockReturnValue({}) }),
      },
    ]);
    getAll.mockResolvedValue([{ exists: false, ref: {} }]);

    await expect(repository.removeVotesBy('uid-1')).resolves.toBe(0);

    expect(batchCommit).not.toHaveBeenCalled();
  });

  // getAll() sem documentos estoura no Firestore, e mural vazio e possivel.
  it('nao consulta votos quando nao ha pergunta nenhuma no mural', async () => {
    await expect(repository.removeVotesBy('uid-1')).resolves.toBe(0);

    expect(getAll).not.toHaveBeenCalled();
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
