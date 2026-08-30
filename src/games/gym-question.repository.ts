import { Injectable } from '@nestjs/common';
import { CollectionReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { BadgeId } from '../track/track.constants';
import { DIFFICULTIES, Difficulty } from './games.constants';
import {
  GymQuestion,
  gymQuestionConverter,
} from './entities/gym-question.entity';

export const GYM_QUESTION_COLLECTION = 'gym_questions';

/** O que o chamador informa ao criar; `createdAt` e `updatedAt` sao daqui. */
export type CreateGymQuestionData = Pick<
  GymQuestion,
  'badgeId' | 'difficulty' | 'question' | 'alternatives' | 'correctIndex'
>;

/** O que pode mudar numa edicao. Nem `badgeId` nem as datas entram. */
export type UpdateGymQuestionData = Partial<
  Pick<GymQuestion, 'difficulty' | 'question' | 'alternatives' | 'correctIndex'>
>;

/** Quantas questoes existem em cada nivel de uma insignia. */
export type DifficultyCounts = Readonly<Record<Difficulty, number>>;

/**
 * O banco de questoes do GYM Challenge (spec 022, decisao 6).
 *
 * Devolve objeto sempre -- `{ found, entry }` e `{ entries }` --, nunca `null`
 * cru: e a regra que fez a migracao de Postgres para Firestore caber em duas
 * classes, e ela vale aqui como valeu la.
 */
@Injectable()
export class GymQuestionRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<GymQuestion> {
    return this.firebase.firestore
      .collection(GYM_QUESTION_COLLECTION)
      .withConverter(gymQuestionConverter);
  }

  /**
   * As questoes de uma insignia, opcionalmente de um nivel so.
   *
   * A ordem e `createdAt` crescente -- a ordem em que o admin escreveu, que e a
   * unica ordem que existe aqui. **Questao nao tem `order`**, e nao vai ter: ela
   * e sorteada aleatoriamente na rodada, entao posicao na lista nao significa
   * nada para quem joga. Ordenar por data e so para a tela do admin nao
   * embaralhar sozinha entre dois carregamentos.
   *
   * Pede indice composto em producao: `badgeId` + `difficulty` com o filtro, e
   * `badgeId` + `createdAt` sem ele. Os dois estao no `firestore.indexes.json`;
   * o emulador nao exige indice nenhum, entao a suite fica verde de qualquer
   * jeito e a falha so aparece ao vivo.
   */
  async listByBadge(
    badgeId: BadgeId,
    difficulty?: Difficulty,
  ): Promise<{ entries: GymQuestion[] }> {
    const base = this.collection.where('badgeId', '==', badgeId);
    const query = difficulty
      ? base.where('difficulty', '==', difficulty)
      : base;

    const snapshot = await query.orderBy('createdAt').get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: GymQuestion | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * As questoes de uma rodada, lidas pelos ids exatos.
   *
   * `getAll` e nao uma consulta: a rodada ja sabe quais questoes serviu, e
   * `where(documentId(), 'in', ...)` teria teto de 30 ids e pediria um indice
   * que este `getAll` dispensa. Questao apagada depois do sorteio simplesmente
   * nao volta, e quem chama decide o que fazer com a ausencia.
   */
  async findByIds(ids: string[]): Promise<{ entries: GymQuestion[] }> {
    if (ids.length === 0) {
      return { entries: [] };
    }

    // O cast existe porque a assinatura de `getAll` no `Firestore` e generica em
    // `DocumentData`, e nao nas refs que entraram. Em tempo de execucao o
    // converter da ref e aplicado -- e o `filter` acima e o que garante que
    // nenhum `undefined` de documento apagado atravesse o cast.
    const snapshots = (await this.firebase.firestore.getAll(
      ...ids.map((id) => this.collection.doc(id)),
    )) as unknown as { exists: boolean; data: () => GymQuestion }[];

    return {
      entries: snapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.data()),
    };
  }

  /**
   * Quantas questoes cada nivel tem, em tres agregados.
   *
   * **`count()`, e nao ler os documentos para medir o tamanho do array.** A tela
   * do admin abre com esta contagem no topo, e ler o banco inteiro de uma
   * insignia para descobrir que ele tem 90 questoes custaria 90 leituras a cada
   * abertura -- e nenhuma delas seria usada. O agregado cobra por indice lido, e
   * nao por documento.
   */
  async countByDifficulty(badgeId: BadgeId): Promise<DifficultyCounts> {
    const counts = await Promise.all(
      DIFFICULTIES.map(async (difficulty) => {
        const snapshot = await this.collection
          .where('badgeId', '==', badgeId)
          .where('difficulty', '==', difficulty)
          .count()
          .get();

        return [difficulty, snapshot.data().count] as const;
      }),
    );

    return Object.fromEntries(counts) as DifficultyCounts;
  }

  async create(data: CreateGymQuestionData): Promise<{ entry: GymQuestion }> {
    const now = new Date();
    const reference = this.collection.doc();

    const entry: GymQuestion = {
      id: reference.id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    // `create()` e nao `set()` -- a regra do repositorio. Aqui o ID e automatico
    // e a colisao e impossivel na pratica, mas a excecao existe para o dia em
    // que alguem passar um ID escolhido: `set()` sobrescreveria a questao de
    // outra pessoa sem dizer nada.
    await reference.create(entry);

    return { entry };
  }

  /**
   * Grava varias questoes de uma vez, num lote so (decisao 10 do admin).
   *
   * O rascunho da IA chega com ate 30 questoes, e trinta `create()` soltos
   * deixariam metade gravada quando o vigesimo falhasse. O lote e tudo ou nada.
   */
  async createMany(
    items: CreateGymQuestionData[],
  ): Promise<{ entries: GymQuestion[] }> {
    const now = new Date();
    const batch = this.firebase.firestore.batch();

    const entries = items.map((data) => {
      const reference = this.collection.doc();
      const entry: GymQuestion = {
        id: reference.id,
        ...data,
        createdAt: now,
        updatedAt: now,
      };

      batch.create(reference, entry);

      return entry;
    });

    await batch.commit();

    return { entries };
  }

  async update(
    id: string,
    data: UpdateGymQuestionData,
  ): Promise<{ found: boolean; entry: GymQuestion | null }> {
    const reference = this.collection.doc(id);
    const snapshot = await reference.get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    const entry: GymQuestion = {
      ...snapshot.data()!,
      ...data,
      updatedAt: new Date(),
    };

    await reference.set(entry);

    return { found: true, entry };
  }

  async delete(id: string): Promise<{ found: boolean }> {
    const reference = this.collection.doc(id);
    const snapshot = await reference.get();

    if (!snapshot.exists) {
      return { found: false };
    }

    await reference.delete();

    return { found: true };
  }
}
