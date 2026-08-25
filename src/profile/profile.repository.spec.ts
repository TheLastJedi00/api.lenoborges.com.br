import { ProfileRepository } from './profile.repository';
import { FirebaseService } from '../auth/firebase.service';

interface DocMock {
  get: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  collection: jest.Mock;
  id: string;
}

interface CollectionMock {
  withConverter: jest.Mock;
  doc: jest.Mock;
}

// Os tipos sao explicitos porque `withConverter: jest.fn(() => collection)`
// dentro do proprio literal se auto-referencia, e a inferencia desiste em `any`.
function buildFirestore() {
  const listDocuments = jest.fn().mockResolvedValue([]);
  const doc: DocMock = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    collection: jest.fn(() => ({ listDocuments })),
    id: 'uid-123',
  };
  const batch = {
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };
  const collection: CollectionMock = {
    withConverter: jest.fn(),
    doc: jest.fn(() => doc),
  };
  collection.withConverter.mockReturnValue(collection);
  const firestore = {
    collection: jest.fn(() => collection),
    batch: jest.fn(() => batch),
  };

  return { firestore, collection, doc, batch, listDocuments };
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

  describe('setEmailOptOut', () => {
    it('grava o opt-out com motivo e carimbo', async () => {
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => profile });
      mocks.doc.update.mockResolvedValue(undefined);

      await expect(
        repository.setEmailOptOut('uid-123', true, 'membro'),
      ).resolves.toEqual({ found: true });

      const [patchData] = mocks.doc.update.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(patchData.emailOptOut).toBe(true);
      expect(patchData.emailOptOutReason).toBe('membro');
      expect(patchData.emailOptOutAt).not.toBeNull();
    });

    it('religar limpa o motivo e o carimbo, e nao deixa rastro velho', async () => {
      mocks.doc.get.mockResolvedValue({ exists: true, data: () => profile });
      mocks.doc.update.mockResolvedValue(undefined);

      await repository.setEmailOptOut('uid-123', false, null);

      const [patchData] = mocks.doc.update.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(patchData.emailOptOut).toBe(false);
      expect(patchData.emailOptOutReason).toBeNull();
      expect(patchData.emailOptOutAt).toBeNull();
    });

    it('perfil inexistente devolve { found: false } em vez de lancar', async () => {
      // O endpoint publico responde 204 de qualquer forma: distinguir seria um
      // oraculo de uid.
      mocks.doc.get.mockResolvedValue({ exists: false });

      await expect(
        repository.setEmailOptOut('uid-fantasma', true, 'bounce'),
      ).resolves.toEqual({ found: false });
      expect(mocks.doc.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    /**
     * Subcolecao nao some com o pai no Firestore. Um delete() sozinho em
     * profiles/{uid} deixaria notification_reads orfa: invisivel no console,
     * cobrada na fatura e impossivel de achar, porque nao ha mais documento pai
     * por onde chegar nela.
     */
    it('apaga a subcolecao notification_reads antes do perfil, no mesmo lote', async () => {
      mocks.listDocuments.mockResolvedValue([{ id: 'n1' }, { id: 'n2' }]);

      await repository.remove('uid-123');

      expect(mocks.doc.collection).toHaveBeenCalledWith('notification_reads');
      // Duas leituras + o proprio perfil, e o perfil por ultimo.
      expect(mocks.batch.delete).toHaveBeenCalledTimes(3);
      expect(mocks.batch.delete).toHaveBeenLastCalledWith(mocks.doc);
      expect(mocks.batch.commit).toHaveBeenCalledTimes(1);
    });

    it('apaga o perfil mesmo quando a pessoa nunca leu notificacao nenhuma', async () => {
      mocks.listDocuments.mockResolvedValue([]);

      await repository.remove('uid-123');

      expect(mocks.batch.delete).toHaveBeenCalledTimes(1);
      expect(mocks.batch.commit).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({ updatedAt: expect.anything() as unknown }),
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
