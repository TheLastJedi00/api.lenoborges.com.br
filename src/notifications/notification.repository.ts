import { Injectable } from '@nestjs/common';
import { CollectionReference } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import { ALREADY_EXISTS } from '../waitlist/waitlist.repository';
import {
  Notification,
  NotificationKind,
  notificationConverter,
  notificationDocId,
} from './entities/notification.entity';
import { BadgeId } from '../track/track.constants';

export const NOTIFICATION_COLLECTION = 'notifications';

/** Teto de leitura da janela. Ver `listWindow`. */
export const NOTIFICATION_WINDOW_LIMIT = 50;

/** Campos que o chamador informa; `id` e `createdAt` sao daqui. */
export type CreateNotificationData = {
  kind: NotificationKind;
  title: string;
  badgeId: BadgeId;
  actorUid: string;
  targetId: string;
};

@Injectable()
export class NotificationRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<Notification> {
    return this.firebase.firestore
      .collection(NOTIFICATION_COLLECTION)
      .withConverter(notificationConverter);
  }

  /**
   * As ultimas notificacoes do produto, mais recentes primeiro.
   *
   * **So ordenacao, nenhum `where`.** Ordenar por um campo unico e atendido pelo
   * indice de campo unico que o Firestore cria sozinho; qualquer `where`
   * combinado com este `orderBy` passaria a exigir um indice composto em
   * producao -- e o emulador nao exige indice, entao a suite continuaria verde e
   * a falha so apareceria no primeiro acesso real.
   *
   * Por isso os cortes da spec (autor da propria notificacao, e o que e anterior
   * a entrada do membro) acontecem **em memoria**, no service. Com teto de 50
   * documentos, filtrar depois de ler nao custa nada mensuravel.
   */
  async listWindow(
    limit: number = NOTIFICATION_WINDOW_LIMIT,
  ): Promise<Notification[]> {
    const snapshot = await this.collection
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data());
  }

  /**
   * Anuncia um evento. **Uma escrita, para a comunidade inteira.**
   *
   * `create()`, nunca `set()`: o caminho carrega o evento, e e o ALREADY_EXISTS
   * daqui que impede o mesmo video virar duas notificacoes num retry de rede.
   *
   * E o ALREADY_EXISTS **e engolido em silencio**, ao contrario do que a
   * waitlist e o Mural fazem com o deles. La a duplicata e uma resposta 409 que
   * o usuario precisa ver; aqui ela significa "esse evento ja foi anunciado", e
   * nao ha nada a fazer nem a contar a ninguem.
   */
  async create(data: CreateNotificationData): Promise<void> {
    const id = notificationDocId(data.kind, data.badgeId, data.targetId);

    try {
      await this.collection.doc(id).create({
        ...data,
        id,
        createdAt: new Date(),
      });
    } catch (error) {
      if ((error as { code?: number })?.code === ALREADY_EXISTS) {
        return;
      }

      throw error;
    }
  }

  /**
   * Apaga a notificacao de uma pergunta moderada.
   *
   * Uma notificacao que leva a uma pergunta removida e um aviso que aponta para
   * o vazio. Vai junto com a subcolecao de votos, no mesmo fluxo de moderacao.
   */
  async deleteForQuestion(questionId: string): Promise<void> {
    await this.collection
      .doc(notificationDocId('pergunta', '', questionId))
      .delete();
  }
}
