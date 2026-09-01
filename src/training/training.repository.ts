import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { BadgeId } from '../track/track.constants';
import { Training, trainingConverter } from './entities/training.entity';
import { DEFAULT_TRAINING_XP } from './training.constants';

export const TRAINING_COLLECTION = 'trainings';

/** Campos que o chamador informa ao criar; o resto o repository preenche. */
export type CreateTrainingData = Pick<
  Training,
  'badgeId' | 'title' | 'description' | 'steps' | 'position'
> & {
  videoUrl?: string | null;
  xpAmount?: number;
};

/** O que a edição pode tocar. `badgeId` fica de fora: mudar de insígnia é criar outro. */
export type UpdateTrainingData = Partial<
  Pick<
    Training,
    'title' | 'description' | 'steps' | 'videoUrl' | 'xpAmount' | 'position'
  >
>;

/**
 * A coleção `trainings` (spec 023, decisão 1).
 *
 * Devolve objeto -- `{ entry }` e `{ entries }` --, nunca `null` cru: é a regra
 * que fez a migração de Postgres para Firestore caber em duas classes, e ela
 * vale aqui pelo mesmo motivo.
 */
@Injectable()
export class TrainingRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<Training> {
    return this.firebase.firestore
      .collection(TRAINING_COLLECTION)
      .withConverter(trainingConverter);
  }

  /**
   * Os treinamentos de uma insígnia, já na ordem.
   *
   * **A ordenação é do servidor**, e não do service depois de ler: ordenar aqui
   * é o que faz a lista ser a mesma para todo mundo, independente de quem a leu.
   *
   * Esta consulta pede um índice composto (`badgeId` asc + `position` asc) no
   * Firestore de produção. Ele não nasce sozinho, e **o emulador não exige
   * índice**: a suíte fica verde e a falha só aparece contra um projeto real,
   * nos dois, com `--project` explícito em cada deploy.
   */
  async listByBadge(badgeId: BadgeId): Promise<{ entries: Training[] }> {
    const snapshot = await this.collection
      .where('badgeId', '==', badgeId)
      .orderBy('position')
      .get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: Training | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Cria o treinamento e devolve o que ficou gravado.
   *
   * **`create()`, nunca `set()`** -- a regra do repositório, mesmo aqui, onde o
   * ID é gerado e a colisão é impossível na prática. Ela vale porque o dia em
   * que alguém trocar o ID gerado por um ID composto, o `set()` sobrescreveria
   * em silêncio e o sintoma seria um enunciado trocado sem autor.
   */
  async create(data: CreateTrainingData): Promise<{ entry: Training }> {
    const now = new Date();
    const ref = this.collection.doc();
    const entry: Training = {
      videoUrl: null,
      ...data,
      xpAmount: data.xpAmount ?? DEFAULT_TRAINING_XP,
      id: ref.id,
      createdAt: now,
      updatedAt: now,
    };

    await ref.create(entry);

    return { entry };
  }

  async update(
    id: string,
    data: UpdateTrainingData,
  ): Promise<{ found: boolean; entry: Training | null }> {
    const ref = this.collection.doc(id);

    const before = await ref.get();
    if (!before.exists) {
      return { found: false, entry: null };
    }

    await ref.update({ ...data, updatedAt: Timestamp.now() });

    const after = await ref.get();

    return { found: true, entry: after.data()! };
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }

  /**
   * Grava as posições 0..n-1 na ordem recebida, **num lote atômico**.
   *
   * Ou entram todas as posições ou nenhuma. Um `update` por treinamento deixaria
   * dois itens no mesmo `position` se a segunda escrita falhasse, e essa lista
   * fica errada em silêncio: ninguém recebe erro, e a Arena só parece estranha.
   * É o mesmo desenho do `BadgeVideoRepository.reorder`, e a mesma razão da
   * decisão 7 da spec 009.
   *
   * A ordem é **renormalizada a cada chamada**, sem posições fracionárias nem
   * espaçamento de 10 em 10 -- que é justamente a parte que apodrece quando
   * ninguém lembra por que os números pulam.
   */
  async reorder(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) {
      return;
    }

    const batch = this.firebase.firestore.batch();
    const updatedAt = Timestamp.now();

    orderedIds.forEach((id, index) => {
      batch.update(this.collection.doc(id), { position: index, updatedAt });
    });

    await batch.commit();
  }
}
