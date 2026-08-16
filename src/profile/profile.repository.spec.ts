import { ProfileRepository } from './profile.repository';
import { FirebaseService } from '../auth/firebase.service';

function buildFirestore() {
  const doc = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    id: 'uid-123',
  };
  const collection = {
    withConverter: jest.fn(() => collection),
    doc: jest.fn(() => doc),
  };
  const firestore = {
    collection: jest.fn(() => collection),
  };

  return { firestore, collection, doc };
}

const profile = {
  id: 'uid-123',
  name: null,
  phone: null,
  bio: null,
  grade: 1,
  completedAt: null,
  waitlistEntryId: null,
  createdAt: new Date('2026-08-16T12:00:00.000Z'),
  updatedAt: new Date('2026-08-16T12:00:00.000Z'),
};

describe('ProfileRepository', () => {
  let repository: ProfileRepository;
  let mocks: ReturnType<typeof buildFirestore>;

  beforeEach(() => {
    mocks = buildFirestore();
    repository = new ProfileRepository({
      firestore: mocks.firestore,
    } as unknown as FirebaseService);
  });

  describe('findById', () => {
    it('le profiles/{uid} por caminho', async () => {
      // O UID do Firebase e o ID do documento. Era isto que a FK para
      // auth.users garantia no Postgres, e aqui nao precisa de garantia: o
      // caminho E a relacao.
      mocks.doc.get.mockResolvedValue({ exists: false });

      await repository.findById('uid-123');

      expect(mocks.collection.doc).toHaveBeenCalledWith('uid-123');
    });

    it('devolve { found: false, entry: null } quando nao existe', async () => {
      mocks.doc.get.mockResolvedValue({ exists: false });

      const result = await repository.findById('uid-123');

      expect(result).toEqual({ found: false, entry: null });
    });

    it('devolve o perfil quando existe', async () => {
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => profile });

      const result = await repository.findById('uid-123');

      expect(result).toEqual({ found: true, entry: profile });
    });
  });

  describe('create', () => {
    it('usa o id recebido como caminho do documento', async () => {
      mocks.doc.create.mockResolvedValue(undefined);

      const result = await repository.create({
        id: 'uid-123',
        name: 'Test',
        phone: null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: null,
      });

      expect(mocks.collection.doc).toHaveBeenCalledWith('uid-123');
      expect(result.entry.id).toBe('uid-123');
    });

    it('preenche createdAt e updatedAt', async () => {
      // Eram @CreateDateColumn e @UpdateDateColumn do TypeORM. Sem ORM, quem
      // preenche e o repository -- e esquecer isso so apareceria como
      // Timestamp.fromDate(undefined) estourando no converter.
      mocks.doc.create.mockResolvedValue(undefined);

      const result = await repository.create({
        id: 'uid-123',
        name: null,
        phone: null,
        bio: null,
        grade: 1,
        completedAt: null,
        waitlistEntryId: null,
      });

      expect(result.entry.createdAt).toBeInstanceOf(Date);
      expect(result.entry.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('atualiza e rele o documento', async () => {
      mocks.doc.update.mockResolvedValue(undefined);
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => profile });

      const result = await repository.update('uid-123', { name: 'Novo' });

      expect(mocks.doc.update).toHaveBeenCalled();
      expect(result.entry).toEqual(profile);
    });

    it('toca o updatedAt a cada update', async () => {
      mocks.doc.update.mockResolvedValue(undefined);
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => profile });

      await repository.update('uid-123', { name: 'Novo' });

      expect(mocks.doc.update).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.anything() }),
      );
    });

    it('estoura quando o documento sumiu entre o update e a releitura', async () => {
      // Era findOneByOrFail no TypeORM. Devolver um entry vazio aqui esconderia
      // uma inconsistencia real atras de um perfil em branco.
      mocks.doc.update.mockResolvedValue(undefined);
      mocks.doc.get.mockResolvedValue({ exists: false });

      await expect(
        repository.update('uid-123', { name: 'Novo' }),
      ).rejects.toThrow(/uid-123/);
    });
  });
});
