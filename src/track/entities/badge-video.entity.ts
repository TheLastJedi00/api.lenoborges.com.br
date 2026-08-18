import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadgeId } from '../track.constants';

/**
 * Um video da trilha, dentro de uma insignia (spec 009).
 *
 * **O ID do documento e `{badgeId}__{youtubeId}`**, e o caminho carrega a
 * garantia, como em `waitlist_entries/{email}` e `profiles/{uid}`: o mesmo video
 * nao entra duas vezes na mesma insignia, porque o `create()` falha com
 * ALREADY_EXISTS. E o mesmo video **pode** aparecer em duas insignias
 * diferentes, que e um caso real -- um video de Git serve a insignia de Git e a
 * de DevOps.
 *
 * **O titulo e nosso porque o do YouTube e de la.** Titulo de video publico e
 * escrito para o algoritmo: carrega "AULA 3 COMPLETA", emoji, nome do canal.
 * Dentro da trilha ele precisa dizer onde a pessoa esta, e precisa poder ser
 * reescrito sem republicar o video.
 *
 * **Guarda-se o ID do YouTube, nunca a URL.** A URL chega em cinco formas; se a
 * forma bruta for gravada, cada tela que monta um player reimplementa a
 * extracao, e elas divergem.
 */
export interface BadgeVideo {
  id: string;
  badgeId: BadgeId;
  title: string;
  description: string | null;
  youtubeId: string;
  /** Posicao dentro da insignia. Inteiro de 0 a n-1, renormalizado a cada mudanca. */
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/** O que vai para o Firestore: sem `id`, que e o caminho, e com Timestamp. */
interface BadgeVideoDocument extends DocumentData {
  badgeId: BadgeId;
  title: string;
  description: string | null;
  youtubeId: string;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Monta o ID do documento. Existe aqui para a regra ter um dono so. */
export function badgeVideoDocId(badgeId: string, youtubeId: string): string {
  return `${badgeId}__${youtubeId}`;
}

export const badgeVideoConverter: FirestoreDataConverter<BadgeVideo> = {
  toFirestore(video: BadgeVideo): BadgeVideoDocument {
    return {
      badgeId: video.badgeId,
      title: video.title,
      description: video.description,
      youtubeId: video.youtubeId,
      order: video.order,
      createdAt: Timestamp.fromDate(video.createdAt),
      updatedAt: Timestamp.fromDate(video.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): BadgeVideo {
    const data = snapshot.data() as BadgeVideoDocument;

    return {
      id: snapshot.id,
      badgeId: data.badgeId,
      title: data.title,
      description: data.description ?? null,
      youtubeId: data.youtubeId,
      order: data.order,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
