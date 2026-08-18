import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import type { BadgeId } from '../../track/track.constants';

/**
 * Uma pergunta do Mural (spec 010).
 *
 * **O ID do documento e `{weekId}__{uid}`**, e o caminho carrega a garantia:
 * uma pergunta por membro por semana, sem consulta e sem indice. O `create()`
 * recusa a segunda com ALREADY_EXISTS, que o service traduz em 409.
 *
 * O limite e de produto, nao tecnico. Um mural com trinta perguntas de cinco
 * pessoas e ilegivel e a votacao se dilui; com uma por pessoa, **quem tem duas
 * duvidas escolhe a melhor** -- que e exatamente o comportamento desejado. E
 * como o `uid` esta no caminho, "qual e a minha pergunta desta semana" tambem e
 * leitura direta.
 *
 * `weekId` nunca vem do cliente: quem carimba e o servidor, na escrita. Cliente
 * que escolhe a propria semana escolhe tambem votar na semana errada.
 */
export interface MuralQuestion {
  id: string;
  /** Data do domingo que abre a semana, `YYYY-MM-DD`. */
  weekId: string;
  badgeId: BadgeId;
  authorUid: string;
  /**
   * Nome do autor, **denormalizado** na criacao.
   *
   * Listar trinta perguntas nao pode custar trinta leituras de perfil. O preco e
   * o nome ficar velho se a pessoa mudar depois, e ele esta aceito e declarado:
   * o nome exibido e o de quando perguntou.
   */
  authorName: string;
  title: string;
  body: string | null;
  /**
   * Contador denormalizado dos votos.
   *
   * Sem ele, ordenar o mural por votos exigiria contar a subcolecao de cada
   * pergunta a cada leitura. Com ele, e um `orderBy('voteCount', 'desc')`.
   * Quem o mantem e o `WriteBatch` do voto, com `FieldValue.increment`.
   */
  voteCount: number;
  /** Vinculo com o video de resposta, quando ele existir. */
  answerVideoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** O que vai para o Firestore: sem `id`, que e o caminho, e com Timestamp. */
interface MuralQuestionDocument extends DocumentData {
  weekId: string;
  badgeId: BadgeId;
  authorUid: string;
  authorName: string;
  title: string;
  body: string | null;
  voteCount: number;
  answerVideoId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Monta o ID do documento. A regra tem um dono so. */
export function questionDocId(weekId: string, uid: string): string {
  return `${weekId}__${uid}`;
}

export const muralQuestionConverter: FirestoreDataConverter<MuralQuestion> = {
  toFirestore(question: MuralQuestion): MuralQuestionDocument {
    return {
      weekId: question.weekId,
      badgeId: question.badgeId,
      authorUid: question.authorUid,
      authorName: question.authorName,
      title: question.title,
      body: question.body,
      voteCount: question.voteCount,
      answerVideoId: question.answerVideoId,
      createdAt: Timestamp.fromDate(question.createdAt),
      updatedAt: Timestamp.fromDate(question.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): MuralQuestion {
    const data = snapshot.data() as MuralQuestionDocument;

    return {
      id: snapshot.id,
      weekId: data.weekId,
      badgeId: data.badgeId,
      authorUid: data.authorUid,
      authorName: data.authorName,
      title: data.title,
      body: data.body ?? null,
      // Pergunta recem-criada pode nao ter o campo se algo escreveu por fora; um
      // undefined aqui viraria NaN na primeira soma da tela.
      voteCount: data.voteCount ?? 0,
      answerVideoId: data.answerVideoId ?? null,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
