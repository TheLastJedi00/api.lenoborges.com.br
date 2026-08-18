import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  FieldValue,
  Timestamp,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  MuralQuestion,
  muralQuestionConverter,
  questionDocId,
} from './entities/mural-question.entity';
import { muralVoteConverter } from './entities/mural-vote.entity';

export const MURAL_COLLECTION = 'mural_questions';
export const VOTE_SUBCOLLECTION = 'votes';

export type CreateQuestionData = Pick<
  MuralQuestion,
  'weekId' | 'badgeId' | 'authorUid' | 'authorName' | 'title' | 'body'
>;

@Injectable()
export class MuralRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<MuralQuestion> {
    return this.firebase.firestore
      .collection(MURAL_COLLECTION)
      .withConverter(muralQuestionConverter);
  }

  /**
   * Perguntas de uma semana.
   *
   * `byVotes` ordena por `voteCount desc` — a semana em votação — e o padrão
   * ordena por `createdAt`, que é a da coleta: lá o voto ainda não abriu, e
   * ordenar por um contador zerado seria ordenar por nada.
   *
   * **Esta consulta pede índice composto no Firestore de produção**
   * (`weekId` + `voteCount`, e `weekId` + `createdAt`). O emulador não exige
   * índice, então a suíte passa verde e a falha só aparece no primeiro acesso
   * real, com um link no erro que ninguém está esperando.
   */
  async listByWeek(weekId: string, byVotes: boolean): Promise<MuralQuestion[]> {
    const query = byVotes
      ? this.collection
          .where('weekId', '==', weekId)
          .orderBy('voteCount', 'desc')
          .orderBy('createdAt', 'asc')
      : this.collection
          .where('weekId', '==', weekId)
          .orderBy('createdAt', 'asc');

    const snapshot = await query.get();
    return snapshot.docs.map((document) => document.data());
  }

  /**
   * A vencedora de uma semana: maior `voteCount`, desempate pela mais antiga.
   *
   * **Derivada, nunca gravada.** Ninguém promove a vencedora — é uma consulta
   * ordenada com `limit(1)`, e por isso não tem como ficar errada nem precisar
   * ser mantida em dia. O desempate precisa ser determinístico, ou duas telas
   * mostram vencedoras diferentes para o mesmo estado.
   */
  async findWinner(
    weekId: string,
  ): Promise<{ found: boolean; entry: MuralQuestion | null }> {
    const snapshot = await this.collection
      .where('weekId', '==', weekId)
      .orderBy('voteCount', 'desc')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.docs[0].data() };
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: MuralQuestion | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /** A pergunta de alguém numa semana. Leitura por caminho, sem consulta. */
  async findMine(
    weekId: string,
    uid: string,
  ): Promise<{ found: boolean; entry: MuralQuestion | null }> {
    return this.findById(questionDocId(weekId, uid));
  }

  async create(data: CreateQuestionData): Promise<{ entry: MuralQuestion }> {
    const now = new Date();
    const id = questionDocId(data.weekId, data.authorUid);
    const entry: MuralQuestion = {
      ...data,
      id,
      voteCount: 0,
      answerVideoId: null,
      createdAt: now,
      updatedAt: now,
    };

    // create(), nunca set(): é o ALREADY_EXISTS daqui que faz o caminho
    // `{weekId}__{uid}` valer como a garantia de uma pergunta por semana.
    await this.collection.doc(id).create(entry);

    return { entry };
  }

  async update(
    id: string,
    data: Partial<Pick<MuralQuestion, 'title' | 'body' | 'answerVideoId'>>,
  ): Promise<{ entry: MuralQuestion }> {
    const ref = this.collection.doc(id);
    await ref.update({ ...data, updatedAt: Timestamp.now() });

    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Pergunta ${id} nao encontrada apos o update.`);
    }

    return { entry: snapshot.data()! };
  }

  /**
   * Quais destas perguntas o usuário já votou.
   *
   * `getAll` por caminho, e não uma consulta por autor: o voto é endereçado por
   * `{questionId}/votes/{uid}`, então saber isso não custa índice nenhum. Sem
   * esta leitura, o front não sabe qual coração pintar e a tela pisca a cada
   * recarga.
   */
  async findMyVotes(questionIds: string[], uid: string): Promise<Set<string>> {
    if (questionIds.length === 0) {
      return new Set();
    }

    const refs = questionIds.map((questionId) =>
      this.collection.doc(questionId).collection(VOTE_SUBCOLLECTION).doc(uid),
    );

    const snapshots = await this.firebase.firestore.getAll(...refs);

    const voted = new Set<string>();
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        voted.add(questionIds[index]);
      }
    });

    return voted;
  }

  /**
   * Vota, ou desfaz o voto, **num lote atômico**.
   *
   * As duas operações — o documento do voto e o `increment` do contador — vão no
   * mesmo `WriteBatch`. Se o voto já existe, o `create()` falha e o lote inteiro
   * falha junto: o contador não se mexe, que é exatamente a proteção contra
   * contar duas vezes.
   *
   * **Nunca ler-somar-escrever.** Duas pessoas votando no mesmo segundo
   * perderiam um voto, e o erro seria invisível — o número simplesmente ficaria
   * menor do que deveria.
   */
  async vote(questionId: string, uid: string): Promise<void> {
    const batch = this.firebase.firestore.batch();
    const question = this.collection.doc(questionId);
    const vote = question
      .collection(VOTE_SUBCOLLECTION)
      .withConverter(muralVoteConverter)
      .doc(uid);

    batch.create(vote, { id: uid, votedAt: new Date() });
    batch.update(question, {
      voteCount: FieldValue.increment(1),
      updatedAt: Timestamp.now(),
    });

    await batch.commit();
  }

  async unvote(questionId: string, uid: string): Promise<void> {
    const batch = this.firebase.firestore.batch();
    const question = this.collection.doc(questionId);
    const vote = question.collection(VOTE_SUBCOLLECTION).doc(uid);

    batch.delete(vote);
    batch.update(question, {
      voteCount: FieldValue.increment(-1),
      updatedAt: Timestamp.now(),
    });

    await batch.commit();
  }

  async hasVoted(questionId: string, uid: string): Promise<boolean> {
    const snapshot = await this.collection
      .doc(questionId)
      .collection(VOTE_SUBCOLLECTION)
      .doc(uid)
      .get();

    return snapshot.exists;
  }

  /**
   * Apaga a pergunta **e os votos dela**.
   *
   * Subcoleção não desaparece com o pai no Firestore — o documento some e os
   * votos ficam órfãos, invisíveis e cobrados. É a pegadinha clássica, e é o
   * motivo de a remoção não ser um `delete()` sozinho.
   */
  async remove(questionId: string): Promise<void> {
    const question = this.collection.doc(questionId);
    const votes = await question.collection(VOTE_SUBCOLLECTION).listDocuments();

    const batch = this.firebase.firestore.batch();
    for (const vote of votes) {
      batch.delete(vote);
    }
    batch.delete(question);

    await batch.commit();
  }
}
