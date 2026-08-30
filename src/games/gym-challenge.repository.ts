import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  FieldValue,
  Timestamp,
  WriteBatch,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { BadgeId } from '../track/track.constants';
import { PROFILE_COLLECTION } from '../profile/profile.repository';
import {
  GymChallenge,
  gymChallengeConverter,
  gymChallengeDocId,
  initialChallenge,
} from './entities/gym-challenge.entity';
import {
  ActiveRoundQuestion,
  activeRoundQuestionConverter,
} from './entities/active-round-question.entity';

export const GYM_CHALLENGE_COLLECTION = 'gym_challenges';
export const ACTIVE_ROUND_SUBCOLLECTION = 'active_round';

/**
 * O estado do desafio de cada membro (spec 022, decisoes 7 e 8).
 *
 * **Apagar um perfil precisa apagar esta colecao e a subcolecao dentro dela.**
 * Quinta vez que este produto esbarra em "subcolecao nao some com o pai", depois
 * dos votos do Mural, de `notification_reads`, de `legal_acceptances` e de
 * `watched_videos`.
 */
@Injectable()
export class GymChallengeRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<GymChallenge> {
    return this.firebase.firestore
      .collection(GYM_CHALLENGE_COLLECTION)
      .withConverter(gymChallengeConverter);
  }

  private docRef(
    badgeId: BadgeId,
    uid: string,
  ): DocumentReference<GymChallenge> {
    return this.collection.doc(gymChallengeDocId(badgeId, uid));
  }

  private activeRoundOf(
    badgeId: BadgeId,
    uid: string,
  ): CollectionReference<ActiveRoundQuestion> {
    return this.firebase.firestore
      .collection(GYM_CHALLENGE_COLLECTION)
      .doc(gymChallengeDocId(badgeId, uid))
      .collection(ACTIVE_ROUND_SUBCOLLECTION)
      .withConverter(activeRoundQuestionConverter);
  }

  profileRef(uid: string): DocumentReference {
    return this.firebase.firestore.collection(PROFILE_COLLECTION).doc(uid);
  }

  batch(): WriteBatch {
    return this.firebase.firestore.batch();
  }

  /**
   * O desafio, **sempre com um valor**.
   *
   * Quem nunca jogou nao tem documento, e isso e o estado normal de quase todo
   * mundo em quase toda insignia. O `found` diz se ha historico; o `entry` diz
   * onde a pessoa esta, e "no comeco" e uma resposta valida.
   */
  async get(
    badgeId: BadgeId,
    uid: string,
  ): Promise<{ found: boolean; entry: GymChallenge }> {
    const snapshot = await this.docRef(badgeId, uid).get();

    if (!snapshot.exists) {
      return { found: false, entry: initialChallenge(badgeId, uid) };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Os desafios do membro nas insignias pedidas, **por caminho**.
   *
   * `getAll` nos caminhos exatos, e nao `where('uid','==',uid)`. Sao as mesmas N
   * leituras, com tres diferencas: nenhum indice (nem automatico), nenhuma linha
   * para insignia que saiu da lista, e custo proporcional ao que a tela mostra em
   * vez de a tudo o que a pessoa ja jogou. E o mesmo desenho do `watched` da
   * spec 019.
   */
  async getMany(
    badgeIds: readonly BadgeId[],
    uid: string,
  ): Promise<Map<BadgeId, GymChallenge>> {
    if (badgeIds.length === 0) {
      return new Map();
    }

    const snapshots = (await this.firebase.firestore.getAll(
      ...badgeIds.map((badgeId) => this.docRef(badgeId, uid)),
    )) as unknown as { exists: boolean; data: () => GymChallenge }[];

    const result = new Map<BadgeId, GymChallenge>();

    badgeIds.forEach((badgeId, index) => {
      const snapshot = snapshots[index];

      result.set(
        badgeId,
        snapshot?.exists ? snapshot.data() : initialChallenge(badgeId, uid),
      );
    });

    return result;
  }

  async save(entry: GymChallenge): Promise<GymChallenge> {
    const next: GymChallenge = { ...entry, updatedAt: new Date() };

    // `set()` e nao `create()`: este documento e um estado que muda a cada
    // rodada, e nao um fato que se registra uma vez. A garantia que o caminho
    // carrega e "um por membro por insignia", e ela vale sem o create.
    await this.docRef(entry.badgeId, entry.uid).set(next);

    return next;
  }

  async listActiveRound(
    badgeId: BadgeId,
    uid: string,
  ): Promise<{ entries: ActiveRoundQuestion[] }> {
    const snapshot = await this.activeRoundOf(badgeId, uid).get();

    return {
      // Ordena em memoria: sao dez documentos, e ordenar por `documentId()` no
      // Firestore ordenaria como texto -- '10' viria antes de '2'. Aqui o indice
      // ja e numero.
      entries: snapshot.docs
        .map((document) => document.data())
        .sort((a, b) => a.index - b.index),
    };
  }

  async findActiveQuestion(
    badgeId: BadgeId,
    uid: string,
    index: number,
  ): Promise<{ found: boolean; entry: ActiveRoundQuestion | null }> {
    const snapshot = await this.activeRoundOf(badgeId, uid)
      .doc(String(index))
      .get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Troca a rodada aberta inteira, num lote so.
   *
   * Apaga o que sobrou de uma rodada abandonada e grava as dez novas. **Um
   * lote**, ou existe um instante em que a rodada tem quatro questoes velhas e
   * seis novas -- e o membro que recarregar nesse instante joga uma prova que
   * nunca existiu.
   *
   * **`set()` para as novas, e nao `create()`, e isto foi medido.** Num lote do
   * Firestore, a pre-condicao do `create()` e avaliada contra o estado
   * **anterior** ao lote: um `delete` do caminho `active_round/0` seguido de um
   * `create` do mesmo caminho, no mesmo lote, falha com `ALREADY_EXISTS`. O
   * defeito seria invisivel na primeira rodada de cada membro e apareceria na
   * segunda -- "Tentar Novamente" respondendo erro, e so para quem reprovou.
   *
   * O `delete` continua sendo necessario: uma rodada de dez seguida de uma de
   * dois deixaria oito documentos velhos que o `set` nao alcanca.
   */
  async replaceActiveRound(
    challenge: GymChallenge,
    questions: ActiveRoundQuestion[],
  ): Promise<void> {
    const collection = this.activeRoundOf(challenge.badgeId, challenge.uid);
    const existing = await collection.listDocuments();
    const batch = this.firebase.firestore.batch();

    for (const ref of existing) {
      batch.delete(ref);
    }

    for (const question of questions) {
      batch.set(collection.doc(String(question.index)), question);
    }

    batch.set(this.docRef(challenge.badgeId, challenge.uid), {
      ...challenge,
      updatedAt: new Date(),
    });

    await batch.commit();
  }

  async clearActiveRound(badgeId: BadgeId, uid: string): Promise<void> {
    const collection = this.activeRoundOf(badgeId, uid);
    const existing = await collection.listDocuments();

    if (existing.length === 0) {
      return;
    }

    const batch = this.firebase.firestore.batch();
    for (const ref of existing) {
      batch.delete(ref);
    }

    await batch.commit();
  }

  /**
   * Grava a resposta e paga o XP **no mesmo lote** (adendo A.7).
   *
   * A resposta gravada e o incremento do perfil sao um fato so: um lote que
   * falhasse pela metade ou pagaria XP por uma resposta que nao ficou gravada,
   * ou gravaria a resposta sem pagar. E a mesma atomicidade da spec 019, com uma
   * diferenca -- aqui o `set` da questao substitui um documento que ja existe,
   * entao quem impede a dupla contagem nao e o `ALREADY_EXISTS`, e a conferencia
   * de `answeredAt` que o service faz antes.
   */
  async recordAnswer(
    badgeId: BadgeId,
    uid: string,
    question: ActiveRoundQuestion,
    xpAwarded: number,
  ): Promise<void> {
    const batch = this.firebase.firestore.batch();

    batch.set(
      this.activeRoundOf(badgeId, uid).doc(String(question.index)),
      question,
    );

    if (xpAwarded > 0) {
      batch.update(this.profileRef(uid), {
        xp: FieldValue.increment(xpAwarded),
        updatedAt: Timestamp.now(),
      });
    }

    await batch.commit();
  }

  /** Apaga o desafio e a subcolecao dentro dele (decisao 14). */
  async removeAll(uid: string, badgeIds: readonly BadgeId[]): Promise<void> {
    for (const badgeId of badgeIds) {
      // A subcolecao primeiro: apagar o pai antes deixaria os dez documentos
      // orfaos -- invisiveis, cobrados e impossiveis de encontrar depois.
      await this.clearActiveRound(badgeId, uid);
      await this.docRef(badgeId, uid).delete();
    }
  }
}
