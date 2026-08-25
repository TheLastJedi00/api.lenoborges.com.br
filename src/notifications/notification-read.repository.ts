import { Injectable } from '@nestjs/common';
import { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { PROFILE_COLLECTION } from '../profile/profile.repository';

export const NOTIFICATION_READ_SUBCOLLECTION = 'notification_reads';

/**
 * O que cada pessoa ja leu (spec 012).
 *
 * Mora em `profiles/{uid}/notification_reads/{notificationId}`, e nao num array
 * no proprio perfil: array cresce sem teto, e o documento do perfil e lido em
 * toda requisicao autenticada -- engordar o perfil para resolver notificacao faz
 * o produto inteiro pagar.
 *
 * **Apagar um perfil precisa apagar esta subcolecao explicitamente.** Subcolecao
 * nao some com o pai no Firestore, e a mesma armadilha ja documentada nos votos
 * do Mural: orfa, ela fica invisivel, cobrada e impossivel de achar.
 */
@Injectable()
export class NotificationReadRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private readDoc(uid: string, notificationId: string): DocumentReference {
    return this.firebase.firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection(NOTIFICATION_READ_SUBCOLLECTION)
      .doc(notificationId);
  }

  /**
   * Marca uma notificacao como lida.
   *
   * **`set()`, e nao `create()`.** Em todo o resto do projeto vale o contrario, e
   * a inversao esta escrita aqui de proposito: marcar como lida precisa ser
   * idempotente, porque o mesmo clique pode chegar duas vezes e a segunda nao e
   * erro. Sao dois caminhos ate a mesma marcacao -- o modal da notificacao e o
   * botao de check da linha (spec 012 do front, decisao 9) --, entao marcar duas
   * vezes e rotina. Um 409 em "ja li isso" seria um erro sem nada a consertar.
   */
  async markRead(uid: string, notificationId: string): Promise<void> {
    await this.readDoc(uid, notificationId).set({ readAt: Timestamp.now() });
  }

  /** Marca varias de uma vez, num lote so. Nunca uma escrita por item. */
  async markAllRead(uid: string, notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) {
      return;
    }

    const batch = this.firebase.firestore.batch();
    const readAt = Timestamp.now();

    notificationIds.forEach((id) => {
      batch.set(this.readDoc(uid, id), { readAt });
    });

    await batch.commit();
  }

  /**
   * Quais destas esta pessoa ja leu.
   *
   * **Um `getAll` por caminho**, exatamente como `MuralRepository.findMyVotes`.
   * Nunca uma consulta por usuario -- que exigiria indice -- e nunca N leituras
   * em laco, que e o que transforma uma tela em conta no fim do mes.
   */
  async findMyReads(
    notificationIds: string[],
    uid: string,
  ): Promise<Set<string>> {
    if (notificationIds.length === 0) {
      return new Set();
    }

    const refs = notificationIds.map((id) => this.readDoc(uid, id));
    const snapshots = await this.firebase.firestore.getAll(...refs);

    const read = new Set<string>();
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        read.add(notificationIds[index]);
      }
    });

    return read;
  }
}
