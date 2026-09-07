import { Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { FakeFirestore } from '../track/testing/fake-firestore';
import {
  TRAINING_COMMENT_COLLECTION,
  TrainingCommentRepository,
} from './training-comment.repository';

describe('TrainingCommentRepository', () => {
  let firestore: FakeFirestore;
  let repository: TrainingCommentRepository;
  let relogio: number;

  beforeEach(() => {
    firestore = new FakeFirestore();
    repository = new TrainingCommentRepository({
      firestore,
    } as unknown as FirebaseService);
    relogio = Date.parse('2026-09-01T12:00:00.000Z');
  });

  /**
   * Cria o comentário e **envelhece o `createdAt` um minuto por chamada**.
   *
   * A ordenação é por `createdAt`, e três `new Date()` seguidos caem no mesmo
   * milissegundo: o teste passaria a depender da ordem de inserção do `Map` do
   * fake, que é exatamente o que ele deveria estar provando. A data é ajustada
   * no documento cru, sem trocar o relógio global -- um `Date` mockado vaza para
   * dentro do repositório e deixa de testar o código que roda em produção.
   */
  async function comentar(content: string, trainingId = 'trn-1', uid = 'u1') {
    const { entry } = await repository.create({
      trainingId,
      uid,
      authorName: 'Ana',
      content,
    });

    relogio += 60_000;
    const cru = firestore.raw(`${TRAINING_COMMENT_COLLECTION}/${entry.id}`)!;
    cru.createdAt = Timestamp.fromMillis(relogio);

    return { ...entry, createdAt: new Date(relogio) };
  }

  describe('create', () => {
    it('grava `adminReply` explicitamente nulo, e não ausente', async () => {
      const entry = await comentar('Primeiro');

      const cru = firestore.raw(
        `${TRAINING_COMMENT_COLLECTION}/${entry.id}`,
      ) as Record<string, unknown>;

      expect(entry.adminReply).toBeNull();
      expect('adminReply' in cru).toBe(true);
    });
  });

  describe('listByTraining', () => {
    it('devolve `{ entries }`, e vazio quando não há comentário', async () => {
      expect(await repository.listByTraining('trn-1')).toEqual({ entries: [] });
    });

    it('devolve do mais recente para o mais antigo', async () => {
      await comentar('Primeiro');
      await comentar('Segundo');
      await comentar('Terceiro');

      const { entries } = await repository.listByTraining('trn-1');

      expect(entries.map((item) => item.content)).toEqual([
        'Terceiro',
        'Segundo',
        'Primeiro',
      ]);
    });

    it('não mistura treinamentos', async () => {
      await comentar('Do primeiro', 'trn-1');
      await comentar('Do segundo', 'trn-2');

      const { entries } = await repository.listByTraining('trn-2');

      expect(entries.map((item) => item.content)).toEqual(['Do segundo']);
    });

    it('respeita o limite pedido', async () => {
      await comentar('Primeiro');
      await comentar('Segundo');
      await comentar('Terceiro');

      const { entries } = await repository.listByTraining('trn-1', {
        limit: 2,
      });

      expect(entries.map((item) => item.content)).toEqual([
        'Terceiro',
        'Segundo',
      ]);
    });
  });

  describe('o cursor', () => {
    it('continua depois da página anterior, sem repetir e sem pular', async () => {
      await comentar('Primeiro');
      await comentar('Segundo');
      await comentar('Terceiro');

      const primeira = await repository.listByTraining('trn-1', { limit: 2 });
      const segunda = await repository.listByTraining('trn-1', {
        limit: 2,
        after: primeira.entries[1].id,
      });

      expect(segunda.entries.map((item) => item.content)).toEqual(['Primeiro']);
    });

    /**
     * O cursor que não existe mais devolve a primeira página, e não um erro.
     *
     * O comentário pode ter sido apagado entre uma página e a seguinte. Numa
     * tela de "Mostrar mais", ver repetido é irritante; ver um erro é a lista
     * inteira sumindo.
     */
    it('ignora um cursor apagado em vez de estourar', async () => {
      await comentar('Primeiro');

      const { entries } = await repository.listByTraining('trn-1', {
        after: 'fantasma',
      });

      expect(entries).toHaveLength(1);
    });
  });

  describe('listRecent', () => {
    it('atravessa treinamentos, do mais recente para o mais antigo', async () => {
      await comentar('Do primeiro', 'trn-1');
      await comentar('Do segundo', 'trn-2');

      const { entries } = await repository.listRecent({ limit: 10 });

      expect(entries.map((item) => item.content)).toEqual([
        'Do segundo',
        'Do primeiro',
      ]);
    });
  });

  describe('setAdminReply', () => {
    it('avisa que não encontrou, em vez de estourar', async () => {
      expect(
        await repository.setAdminReply('fantasma', {
          content: 'Resposta',
          authorName: 'Leno',
          repliedAt: new Date(),
        }),
      ).toEqual({ found: false, entry: null });
    });

    it('grava a resposta e preserva quem perguntou', async () => {
      const comentario = await comentar('Travei no passo 3');

      const { entry } = await repository.setAdminReply(comentario.id, {
        content: 'Rode npm ci antes.',
        authorName: 'Leno',
        repliedAt: new Date('2026-09-02T09:00:00.000Z'),
      });

      expect(entry?.adminReply?.content).toBe('Rode npm ci antes.');
      expect(entry?.adminReply?.authorName).toBe('Leno');
      expect(entry?.content).toBe('Travei no passo 3');
      expect(entry?.authorName).toBe('Ana');
    });

    it('responder de novo sobrescreve a resposta anterior', async () => {
      const comentario = await comentar('Travei no passo 3');

      await repository.setAdminReply(comentario.id, {
        content: 'Primeira tentativa',
        authorName: 'Leno',
        repliedAt: new Date('2026-09-02T09:00:00.000Z'),
      });
      const { entry } = await repository.setAdminReply(comentario.id, {
        content: 'Na verdade, é o Node 22.',
        authorName: 'Leno',
        repliedAt: new Date('2026-09-02T10:00:00.000Z'),
      });

      expect(entry?.adminReply?.content).toBe('Na verdade, é o Node 22.');
    });
  });

  describe('a limpeza', () => {
    it('apaga os comentários do treinamento excluído, e só os dele', async () => {
      await comentar('Do primeiro', 'trn-1');
      await comentar('Também do primeiro', 'trn-1');
      await comentar('Do segundo', 'trn-2');

      await repository.removeAllByTraining('trn-1');

      expect((await repository.listByTraining('trn-1')).entries).toHaveLength(
        0,
      );
      expect((await repository.listByTraining('trn-2')).entries).toHaveLength(
        1,
      );
    });

    it('apaga os comentários de quem pediu para ser esquecido, e só os dele', async () => {
      await comentar('Da Ana', 'trn-1', 'ana');
      await comentar('Do Beto', 'trn-1', 'beto');

      await repository.removeAllByUid('ana');

      const { entries } = await repository.listByTraining('trn-1');

      expect(entries.map((item) => item.content)).toEqual(['Do Beto']);
    });

    it('não faz nada quando não há o que apagar', async () => {
      await expect(
        repository.removeAllByTraining('trn-vazio'),
      ).resolves.toBeUndefined();
    });
  });
});
