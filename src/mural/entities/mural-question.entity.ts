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

/**
 * Autor de uma pergunta cuja conta foi excluida (spec 013, decisao 6).
 *
 * A pergunta do Mural nao e so de quem perguntou: tem votos de outras pessoas,
 * pode ter vencido a semana e pode ter virado video na trilha. Apaga-la levaria
 * junto o voto de terceiros e deixaria um video respondendo a uma pergunta que
 * nao existe mais. Entao o texto fica e o autor some: `authorUid` vira esta
 * constante e `authorName` vira 'Membro removido'.
 *
 * **O `uid` original continua no caminho do documento** -- `{weekId}__{uid}` --
 * e nao ha como tira-lo de la sem recriar a pergunta e migrar a subcolecao de
 * votos inteira. Depois da exclusao ele e uma cadeia opaca que **nao resolve
 * para ninguem**: nao ha usuario no Auth, nao ha perfil, nao ha entrada na lista
 * de espera. Identificador orfao nao identifica, e e isso que faz a operacao ser
 * eliminacao e nao pseudonimizacao, para efeito de LGPD.
 *
 * > **A condicao para isso continuar verdadeiro e uma so: nenhuma colecao nova
 * > pode guardar `uid` ao lado de dado pessoal.** Log persistente com uid e
 * > e-mail juntos, tabela de analytics, backup de perfil "por garantia" --
 * > qualquer um desses reata o vinculo e transforma anonimizacao em
 * > pseudonimizacao. E a restricao que a proxima spec de observabilidade precisa
 * > ler antes de escrever a primeira linha.
 */
export const ANONYMOUS_AUTHOR_UID = '__removido__';

/** Nome exibido no lugar do de quem se excluiu. */
export const ANONYMOUS_AUTHOR_NAME = 'Membro removido';

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
