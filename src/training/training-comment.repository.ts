import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  Timestamp,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  TrainingComment,
  TrainingCommentReply,
  trainingCommentConverter,
} from './entities/training-comment.entity';
import { TRAINING_COMMENTS_PAGE_SIZE } from './training.constants';

export const TRAINING_COMMENT_COLLECTION = 'training_comments';

/** O tamanho de lote do Firestore é 500; 400 deixa folga para o `updatedAt`. */
const BATCH_SIZE = 400;

export type CreateTrainingCommentData = Pick<
  TrainingComment,
  'trainingId' | 'uid' | 'authorName' | 'content'
>;

export interface ListCommentsOptions {
  limit?: number;
  /**
   * O id do **último comentário da página anterior**, e não uma data.
   *
   * Um cursor por data obrigaria o cliente a devolver um `Timestamp` formatado
   * exatamente como o banco o guarda, e a primeira divergência de fuso ou de
   * milissegundo pula ou repete uma linha sem erro nenhum. O id é opaco para
   * quem consome, que é o que um cursor deve ser.
   */
  after?: string;
}

@Injectable()
export class TrainingCommentRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<TrainingComment> {
    return this.firebase.firestore
      .collection(TRAINING_COMMENT_COLLECTION)
      .withConverter(trainingCommentConverter);
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: TrainingComment | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  async create(
    data: CreateTrainingCommentData,
  ): Promise<{ entry: TrainingComment }> {
    const now = new Date();
    const ref = this.collection.doc();
    const entry: TrainingComment = {
      ...data,
      // Nasce explicitamente nulo, e não ausente: `where`/`orderBy` do Firestore
      // não enxergam documento sem o campo, e um dia alguém vai querer listar os
      // que ainda não foram respondidos.
      adminReply: null,
      id: ref.id,
      createdAt: now,
      updatedAt: now,
    };

    await ref.create(entry);

    return { entry };
  }

  /**
   * Os comentários de um treinamento, do mais recente para o mais antigo.
   *
   * Pede o índice composto `trainingId` asc + `createdAt` desc em produção.
   *
   * O cursor é resolvido aqui: o `after` chega como id, esta função lê o
   * documento e usa o `createdAt` dele no `startAfter`. Um `after` que não
   * existe mais -- comentário apagado entre duas páginas -- devolve a primeira
   * página em vez de estourar, que é o comportamento certo para uma tela de
   * "Mostrar mais": a pessoa vê repetido, e não vê um erro.
   */
  async listByTraining(
    trainingId: string,
    options: ListCommentsOptions = {},
  ): Promise<{ entries: TrainingComment[] }> {
    const limit = options.limit ?? TRAINING_COMMENTS_PAGE_SIZE;

    let query = this.collection
      .where('trainingId', '==', trainingId)
      .orderBy('createdAt', 'desc');

    if (options.after) {
      const cursor = await this.collection.doc(options.after).get();
      const entry = cursor.exists ? cursor.data() : null;

      if (entry) {
        query = query.startAfter(Timestamp.fromDate(entry.createdAt));
      }
    }

    const snapshot = await query.limit(limit).get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  /**
   * Os comentários mais recentes de **todos** os treinamentos, para o painel do
   * admin.
   *
   * Ordenação por um campo só, então o índice é o automático de `createdAt`.
   */
  async listRecent(options: { limit: number }): Promise<{
    entries: TrainingComment[];
  }> {
    const snapshot = await this.collection
      .orderBy('createdAt', 'desc')
      .limit(options.limit)
      .get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  /**
   * Grava a resposta do admin no comentário.
   *
   * `update` parcial, e não `set`: o `set` passaria pelo converter e
   * reescreveria o documento inteiro, apagando o `createdAt` de quem perguntou
   * se algum campo fosse esquecido no caminho.
   */
  async setAdminReply(
    id: string,
    reply: TrainingCommentReply,
  ): Promise<{ found: boolean; entry: TrainingComment | null }> {
    const ref = this.collection.doc(id);

    const before = await ref.get();
    if (!before.exists) {
      return { found: false, entry: null };
    }

    await ref.update({
      adminReply: {
        content: reply.content,
        authorName: reply.authorName,
        repliedAt: Timestamp.fromDate(reply.repliedAt),
      },
      updatedAt: Timestamp.now(),
    });

    const after = await ref.get();

    return { found: true, entry: after.data()! };
  }

  /**
   * Apaga os comentários de um treinamento excluído.
   *
   * Nada some junto com o pai no Firestore. Sem esta chamada, os comentários de
   * um desafio apagado ficam invisíveis, cobrados e impossíveis de encontrar
   * depois -- a mesma armadilha dos votos do Mural, de `notification_reads`, de
   * `legal_acceptances` e de `watched_videos`.
   */
  async removeAllByTraining(trainingId: string): Promise<void> {
    await this.removeWhere('trainingId', trainingId);
  }

  /** Apaga os comentários de quem pediu para ser esquecido (spec 013). */
  async removeAllByUid(uid: string): Promise<void> {
    await this.removeWhere('uid', uid);
  }

  /**
   * Apaga em lotes de 400, e não um documento por vez.
   *
   * Uma exclusão por documento deixa metade do trabalho feito quando a rede cai
   * no meio, e o que sobra é exatamente o que esta função existe para não
   * deixar. Mesmo desenho do `savePositions` do ranking.
   */
  private async removeWhere(field: string, value: string): Promise<void> {
    const snapshot = await this.collection.where(field, '==', value).get();

    if (snapshot.empty) {
      return;
    }

    const refs = snapshot.docs.map((document) =>
      this.collection.doc(document.id),
    ) as DocumentReference<TrainingComment>[];

    for (let start = 0; start < refs.length; start += BATCH_SIZE) {
      const batch = this.firebase.firestore.batch();

      for (const ref of refs.slice(start, start + BATCH_SIZE)) {
        batch.delete(ref);
      }

      await batch.commit();
    }
  }
}
