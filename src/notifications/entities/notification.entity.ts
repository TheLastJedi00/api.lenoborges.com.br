import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import type { BadgeId } from '../../track/track.constants';

/**
 * Um aviso interno do produto (spec 012).
 *
 * **A notificacao e uma so, global, e nunca uma por pessoa.** Fan-out custaria N
 * escritas por evento e cresceria com a comunidade -- cem membros sao cem
 * documentos por video publicado -- e faria o mesmo evento existir em cem
 * copias, com correcao de titulo virando varredura. O que e por pessoa e apenas
 * o que ela **ja leu**, e isso mora em `profiles/{uid}/notification_reads`.
 *
 * **O ID do documento carrega o evento:** `video__{badgeId}__{youtubeId}` e
 * `pergunta__{questionId}`. E a mesma regra de `waitlist_entries/{email}` e de
 * `badge_videos/{badgeId}__{youtubeId}`: o caminho e a garantia de unicidade,
 * porque o Firestore nao tem UNIQUE. Com ela, um POST repetido por clique duplo
 * ou retry de rede nao produz duas notificacoes do mesmo video.
 */
export type NotificationKind = 'video' | 'pergunta';

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** Titulo do video ou da pergunta, **cru**. Abreviar e decisao de layout. */
  title: string;
  badgeId: BadgeId;
  /**
   * Quem publicou.
   *
   * A listagem descarta as notificacoes em que o `actorUid` e o proprio leitor.
   * Sem isso, o membro escreve a pergunta dele e o sino toca por causa dela --
   * o tipo de detalhe que faz o recurso parecer quebrado no primeiro uso, porque
   * o primeiro uso de quase todo mundo e escrever.
   */
  actorUid: string;
  /**
   * O `youtubeId` do video, ou o id da pergunta.
   *
   * Nenhuma tela usa hoje: o destino dos dois eventos e uma lista, nao um item.
   * Existe porque e o unico dado que **nao da para reconstruir depois** se um dia
   * a notificacao precisar levar ao item exato, e grava-lo agora custa um campo.
   */
  targetId: string;
  createdAt: Date;
}

/** O que vai para o Firestore: sem `id`, que e o caminho, e com Timestamp. */
interface NotificationDocument extends DocumentData {
  kind: NotificationKind;
  title: string;
  badgeId: BadgeId;
  actorUid: string;
  targetId: string;
  createdAt: Timestamp;
}

/**
 * Monta o ID do documento. Existe aqui para a regra ter um dono so, como
 * `badgeVideoDocId` e `questionDocId`.
 */
export function notificationDocId(
  kind: NotificationKind,
  badgeId: string,
  targetId: string,
): string {
  return kind === 'video'
    ? `video__${badgeId}__${targetId}`
    : `pergunta__${targetId}`;
}

export const notificationConverter: FirestoreDataConverter<Notification> = {
  toFirestore(notification: Notification): NotificationDocument {
    return {
      kind: notification.kind,
      title: notification.title,
      badgeId: notification.badgeId,
      actorUid: notification.actorUid,
      targetId: notification.targetId,
      createdAt: Timestamp.fromDate(notification.createdAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): Notification {
    const data = snapshot.data() as NotificationDocument;

    return {
      id: snapshot.id,
      kind: data.kind,
      title: data.title,
      badgeId: data.badgeId,
      actorUid: data.actorUid,
      targetId: data.targetId,
      createdAt: data.createdAt.toDate(),
    };
  },
};
