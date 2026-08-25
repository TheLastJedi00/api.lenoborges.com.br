import { WaitlistRepository } from './waitlist.repository';
import { FirebaseService } from '../auth/firebase.service';

interface DocMock {
  get: jest.Mock;
  create: jest.Mock;
  delete: jest.Mock;
  id: string;
}

interface CollectionMock {
  withConverter: jest.Mock;
  doc: jest.Mock;
}

// Os tipos sao explicitos porque `withConverter: jest.fn(() => collection)`
// dentro do proprio literal se auto-referencia, e a inferencia desiste em `any`.
function buildFirestore() {
  const doc: DocMock = {
    get: jest.fn(),
    create: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    id: 'test@test.com',
  };
  const collection: CollectionMock = {
    withConverter: jest.fn(),
    doc: jest.fn(() => doc),
  };
  collection.withConverter.mockReturnValue(collection);
  const firestore = { collection: jest.fn(() => collection) };

  return { firestore, collection, doc };
}

describe('WaitlistRepository', () => {
  let repository: WaitlistRepository;
  let mocks: ReturnType<typeof buildFirestore>;

  beforeEach(() => {
    mocks = buildFirestore();
    repository = new WaitlistRepository({
      firestore: mocks.firestore,
    } as unknown as FirebaseService);
  });

  describe('findByEmail', () => {
    it('le por caminho de documento, sem consulta', async () => {
      // O e-mail e o ID do documento, entao nao existe where nem indice: a
      // leitura e direta. Se algum dia isto virar query, a unicidade da decisao
      // 6 da spec 007 foi perdida junto.
      mocks.doc.get.mockResolvedValue({ exists: false });

      await repository.findByEmail('test@test.com');

      expect(mocks.collection.doc).toHaveBeenCalledWith('test@test.com');
    });

    it('devolve { found: false } quando o documento nao existe', async () => {
      mocks.doc.get.mockResolvedValue({ exists: false });

      const result = await repository.findByEmail('nope@test.com');

      expect(result).toEqual({ found: false });
    });

    it('devolve { found: true, entry } quando existe', async () => {
      const entry = {
        id: 'test@test.com',
        name: 'Test',
        phone: '11999998888',
        email: 'test@test.com',
        consent: true,
        createdAt: new Date('2026-08-13T18:20:31.412Z'),
      };
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => entry });

      const result = await repository.findByEmail('test@test.com');

      expect(result).toEqual({ found: true, entry });
    });
  });

  describe('create', () => {
    it('usa create() e nao set(), para falhar quando ja existe', async () => {
      // set() sobrescreveria em silencio, e a inscricao anterior sumiria. O
      // create() e o que faz o Firestore recusar duplicata -- e o ALREADY_EXISTS
      // dele que ocupa o lugar do 23505 do Postgres no service.
      mocks.doc.create.mockResolvedValue(undefined);
      mocks.doc.get.mockResolvedValue({
        exists: true,
        data: () => ({ id: 'test@test.com' }),
      });

      await repository.create({
        name: 'Test',
        phone: '11999998888',
        email: 'test@test.com',
        consent: true,
      });

      expect(mocks.doc.create).toHaveBeenCalled();
      expect((mocks.doc as unknown as { set?: unknown }).set).toBeUndefined();
    });

    it('endereca o documento pelo e-mail', async () => {
      mocks.doc.create.mockResolvedValue(undefined);
      mocks.doc.get.mockResolvedValue({
        exists: true,
        data: () => ({ id: 'test@test.com' }),
      });

      await repository.create({
        name: 'Test',
        phone: '11999998888',
        email: 'test@test.com',
        consent: true,
      });

      expect(mocks.collection.doc).toHaveBeenCalledWith('test@test.com');
    });

    it('propaga o ALREADY_EXISTS para o service traduzir', async () => {
      // O repository nao decide o que fazer com a corrida: quem sabe que
      // duplicata vira recibo do registro anterior e o service.
      const alreadyExists = Object.assign(new Error('already exists'), {
        code: 6,
      });
      mocks.doc.create.mockRejectedValue(alreadyExists);

      await expect(
        repository.create({
          name: 'Test',
          phone: '11999998888',
          email: 'test@test.com',
          consent: true,
        }),
      ).rejects.toBe(alreadyExists);
    });
  });

  describe('remove', () => {
    /**
     * A inscricao guarda nome, telefone e e-mail: e dado pessoal puro, e e o
     * registro mais facil de esquecer numa exclusao de conta, porque nenhuma
     * tela do painel o mostra.
     */
    it('apaga por caminho, com o e-mail normalizado como id', async () => {
      await repository.remove('test@test.com');

      expect(mocks.collection.doc).toHaveBeenCalledWith('test@test.com');
      expect(mocks.doc.delete).toHaveBeenCalledTimes(1);
    });
  });
});
