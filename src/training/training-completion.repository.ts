import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  WriteBatch,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  TrainingCompletion,
  trainingCompletionConverter,
  trainingCompletionDocId,
} from './entities/training-completion.entity';

export const TRAINING_COMPLETION_COLLECTION = 'training_completions';

/** O tamanho de lote do Firestore é 500; 400 deixa folga. */
const BATCH_SIZE = 400;

@Injectable()
export class TrainingCompletionRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<TrainingCompletion> {
    return this.firebase.firestore
      .collection(TRAINING_COMPLETION_COLLECTION)
      .withConverter(trainingCompletionConverter);
  }

  private docRef(
    uid: string,
    trainingId: string,
  ): DocumentReference<TrainingCompletion> {
    return this.collection.doc(trainingCompletionDocId(uid, trainingId));
  }

  async findById(
    uid: string,
    trainingId: string,
  ): Promise<{ found: boolean; entry: TrainingCompletion | null }> {
    const snapshot = await this.docRef(uid, trainingId).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Escreve a conclusão **dentro de um lote que já existe**.
   *
   * Recebe o `WriteBatch` de fora em vez de criar o próprio, e é isso que faz o
   * XP andar junto da prova: quem paga escreve as duas coisas de uma vez, e um
   * `commit` que falha não paga nem uma nem outra. Duas escritas separadas
   * criariam um XP que nenhuma conclusão explica, e nada depois compararia os
   * dois para descobrir.
   *
   * **`create()`, nunca `set()`.** É o `ALREADY_EXISTS` daqui que derruba o lote
   * inteiro quando o desafio já foi concluído -- e é essa derrubada, e não um
   * `if`, que impede o incremento de XP. Mesmo desenho do
   * `WatchedVideoRepository` da spec 019.
   */
  create(
    batch: WriteBatch,
    data: { uid: string; trainingId: string; xpAwarded: number; now: Date },
  ): void {
    batch.create(this.docRef(data.uid, data.trainingId), {
      id: trainingCompletionDocId(data.uid, data.trainingId),
      uid: data.uid,
      trainingId: data.trainingId,
      xpAwarded: data.xpAwarded,
      completedAt: data.now,
    });
  }

  /**
   * Quais destes treinamentos o membro já concluiu.
   *
   * É um `getAll` nos caminhos exatos, e não um `where('uid', '==', uid)`
   * (mesma decisão do `findWatchedIds` da spec 019). São as mesmas N leituras, e
   * três diferenças: nenhum índice, nem automático; nenhuma linha de
   * treinamento já removido da insígnia; e custo proporcional ao que a tela
   * mostra, e não a tudo o que a pessoa já concluiu na vida.
   *
   * Treinamento sem documento é `false`. Não existe "não sei".
   */
  async findCompletedIds(
    uid: string,
    trainingIds: readonly string[],
  ): Promise<Set<string>> {
    if (trainingIds.length === 0) {
      // `getAll()` sem documento nenhum estoura no Firestore, e insígnia sem
      // treinamento é o estado normal do produto no lançamento.
      return new Set();
    }

    const snapshots = await this.firebase.firestore.getAll(
      ...trainingIds.map((trainingId) => this.docRef(uid, trainingId)),
    );

    const completed = new Set<string>();
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        completed.add(trainingIds[index]);
      }
    });

    return completed;
  }

  /** Apaga as conclusões de quem pediu para ser esquecido (spec 013). */
  async removeAll(uid: string): Promise<void> {
    await this.removeWhere('uid', uid);
  }

  /**
   * Apaga as conclusões de um treinamento excluído.
   *
   * Sem isto, elas ficam invisíveis, cobradas e impossíveis de encontrar --
   * e um treinamento recriado com o mesmo id herdaria conclusões de um desafio
   * que já não existe.
   */
  async removeAllByTraining(trainingId: string): Promise<void> {
    await this.removeWhere('trainingId', trainingId);
  }

  private async removeWhere(field: string, value: string): Promise<void> {
    const snapshot = await this.collection.where(field, '==', value).get();

    if (snapshot.empty) {
      return;
    }

    const refs = snapshot.docs.map((document) =>
      this.collection.doc(document.id),
    );

    for (let start = 0; start < refs.length; start += BATCH_SIZE) {
      const batch = this.firebase.firestore.batch();

      for (const ref of refs.slice(start, start + BATCH_SIZE)) {
        batch.delete(ref);
      }

      await batch.commit();
    }
  }
}
