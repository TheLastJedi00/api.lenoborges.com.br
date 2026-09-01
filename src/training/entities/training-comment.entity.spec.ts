import { QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import {
  TrainingComment,
  trainingCommentConverter,
} from './training-comment.entity';

function snapshot(data: Record<string, unknown>): QueryDocumentSnapshot {
  return {
    id: 'cmt-001',
    data: () => data,
  } as unknown as QueryDocumentSnapshot;
}

const AGORA = new Date('2026-09-01T12:00:00.000Z');
const DEPOIS = new Date('2026-09-02T09:30:00.000Z');

function comentarioBase(extra: Partial<TrainingComment> = {}): TrainingComment {
  return {
    id: 'cmt-001',
    trainingId: 'trn-001',
    uid: 'uid-123',
    authorName: 'Ana',
    content: 'Travei no passo 3, o teste não roda.',
    adminReply: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...extra,
  };
}

describe('trainingCommentConverter', () => {
  describe('ida e volta', () => {
    it('devolve o mesmo comentário que gravou', () => {
      const comment = comentarioBase();

      const gravado = trainingCommentConverter.toFirestore(comment);

      expect(trainingCommentConverter.fromFirestore(snapshot(gravado))).toEqual(
        comment,
      );
    });

    it('devolve a resposta do admin inteira, com a data', () => {
      const comment = comentarioBase({
        adminReply: {
          content: 'Rode `npm ci` antes. O lock estava velho.',
          authorName: 'Leno',
          repliedAt: DEPOIS,
        },
      });

      const gravado = trainingCommentConverter.toFirestore(comment);
      const lido = trainingCommentConverter.fromFirestore(snapshot(gravado));

      expect(lido.adminReply).toEqual({
        content: 'Rode `npm ci` antes. O lock estava velho.',
        authorName: 'Leno',
        repliedAt: DEPOIS,
      });
    });

    it('grava a data da resposta como Timestamp', () => {
      const gravado = trainingCommentConverter.toFirestore(
        comentarioBase({
          adminReply: {
            content: 'Resposta',
            authorName: 'Leno',
            repliedAt: DEPOIS,
          },
        }),
      );

      // O `toFirestore` do converter devolve `DocumentData`, entao o campo
      // chega sem tipo: o cast e o que faz o teste falar do Timestamp.
      const reply = gravado.adminReply as { repliedAt: unknown } | null;

      expect(reply?.repliedAt).toBeInstanceOf(Timestamp);
    });
  });

  /**
   * O teste-trava do documento sem `adminReply`.
   *
   * **O que ele impede:** `undefined` chegando no DTO da listagem. Não é o
   * comentário que some -- é a resposta inteira da rota, para todo mundo, por
   * causa de um documento gravado por um caminho que ninguém previu.
   */
  describe('documento gravado sem `adminReply`', () => {
    it('lê a resposta como nula, e nunca `undefined`', () => {
      const gravado = trainingCommentConverter.toFirestore(comentarioBase());
      delete (gravado as Record<string, unknown>).adminReply;

      const lido = trainingCommentConverter.fromFirestore(snapshot(gravado));

      expect(lido.adminReply).toBeNull();
      expect('adminReply' in lido).toBe(true);
    });
  });
});
