import { EmailCampaignRepository } from './email-campaign.repository';
import { FirebaseService } from '../auth/firebase.service';

describe('EmailCampaignRepository', () => {
  let repository: EmailCampaignRepository;
  let doc: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let where: jest.Mock;
  let orderBy: jest.Mock;
  let limit: jest.Mock;
  let get: jest.Mock;

  const base = {
    kind: 'manual' as const,
    subject: 'Assunto',
    body: 'Corpo',
    ctaLabel: null,
    ctaUrl: null,
    filters: { tiers: null, gradeMin: null, gradeMax: null },
    audienceCount: 42,
    createdBy: 'admin-1',
  };

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(undefined);
    update = jest.fn().mockResolvedValue(undefined);
    get = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    limit = jest.fn().mockReturnValue({ get });
    orderBy = jest.fn().mockReturnValue({ limit, get });
    where = jest.fn().mockReturnValue({ limit, get });

    doc = jest.fn((id?: string) => ({
      id: id ?? 'auto-id',
      create,
      update,
      get: jest.fn().mockResolvedValue({ exists: false }),
    }));

    const firestore = {
      collection: jest.fn().mockReturnValue({
        withConverter: jest.fn().mockReturnValue({ doc, where, orderBy }),
      }),
    };

    repository = new EmailCampaignRepository({
      firestore,
    } as unknown as FirebaseService);
  });

  /**
   * `set()` sobrescreveria a campanha anterior em silêncio. Para a de vídeo,
   * cujo id é o caminho composto, é o ALREADY_EXISTS do `create()` que impede um
   * retry de rede de anunciar o mesmo vídeo duas vezes para a base inteira.
   */
  it('cria com create(), nunca set(), e ja nasce enviando', async () => {
    const { entry } = await repository.create(base);

    expect(create).toHaveBeenCalledTimes(1);
    expect(entry.status).toBe('enviando');
    expect(entry.sentCount).toBe(0);
    expect(entry.cursorUid).toBeNull();
    expect(entry.finishedAt).toBeNull();
  });

  it('a campanha de video usa o id que veio; a manual pega um auto-id', async () => {
    await repository.create({ ...base, id: 'video__logica__abc' });
    expect(doc).toHaveBeenCalledWith('video__logica__abc');

    doc.mockClear();
    await repository.create(base);
    expect(doc).toHaveBeenCalledWith();
  });

  it('updateProgress grava cursor e contadores, e nao toca no status', async () => {
    await repository.updateProgress('camp-1', 'uid-099', 100, 0);

    const [patch] = update.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toEqual({
      cursorUid: 'uid-099',
      sentCount: 100,
      failedCount: 0,
    });
    expect('status' in patch).toBe(false);
  });

  it('finish carimba o fim junto com o status', async () => {
    await repository.finish('camp-1', 'interrompida', 'rate limit');

    const [patch] = update.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe('interrompida');
    expect(patch.error).toBe('rate limit');
    expect(patch.finishedAt).toBeDefined();
  });

  /**
   * Ordenação por um campo só e filtro por um campo só: **nenhum índice
   * composto novo** (decisão 13). Cada `where` combinado com ordenação viraria
   * uma linha nova na tabela de índices que produção exige.
   */
  it('listRecent ordena por createdAt e nao filtra nada', async () => {
    await repository.listRecent(20);

    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(where).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(20);
  });

  it('findSending filtra por status e nao ordena', async () => {
    await repository.findSending();

    expect(where).toHaveBeenCalledWith('status', '==', 'enviando');
    expect(orderBy).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('findSending devolve o contrato { found, entry } quando nao ha nenhuma', async () => {
    await expect(repository.findSending()).resolves.toEqual({
      found: false,
      entry: null,
    });
  });
});
