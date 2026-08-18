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
export type BadgeVideoKind = 'aula' | 'resposta';

export interface BadgeVideo {
  id: string;
  badgeId: BadgeId;
  title: string;
  description: string | null;
  youtubeId: string;
  /**
   * A natureza do video (spec 010).
   *
   * Aula se assiste em ordem; resposta se consulta por assunto. Sao duas listas
   * com propositos diferentes, e misturadas a trilha fica com respostas avulsas
   * no meio da sequencia -- e a sequencia deixa de ser sequencia.
   */
  kind: BadgeVideoKind;
  /** A pergunta que originou a resposta. Nulo em toda aula. */
  questionId: string | null;
  /**
   * Libera o video para todo mundo, mesmo numa insignia adiantada.
   *
   * **A precedencia e total, e a ordem importa:** quando existir gate de
   * conteudo, ele comeca por esta flag e sai. Ela nao e um empate a ser
   * resolvido depois de conferir tier e insignia.
   *
   * Existe porque o Mural cria uma armadilha: a melhor pergunta da semana pode
   * ser sobre Angular, a resposta vira um video excelente, e ele nasce trancado
   * para 90% de quem votou nela. A marcacao e a valvula.
   */
  devTierFree: boolean;
  /**
   * Posicao dentro da insignia **e da aba**. Inteiro de 0 a n-1.
   *
   * A renormalizacao acontece dentro de `(badgeId, kind)`, e nao da insignia
   * inteira: uma insignia com tres aulas e duas respostas tem duas sequencias
   * independentes. Renormalizar sem separar por `kind` embaralharia as duas
   * abas de uma vez -- e e o bug mais provavel desta spec.
   */
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
  kind: BadgeVideoKind;
  questionId: string | null;
  devTierFree: boolean;
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
      kind: video.kind,
      questionId: video.questionId,
      devTierFree: video.devTierFree,
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
      // Documento anterior a spec 010 nao tem estes tres campos -- e sao todos
      // os videos ja publicados. Sem os defaults, `kind` chega undefined e o
      // filtro por aba devolve lista vazia: a trilha some sem ninguem ter
      // apagado nada.
      kind: data.kind ?? 'aula',
      questionId: data.questionId ?? null,
      devTierFree: data.devTierFree ?? false,
      order: data.order,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
