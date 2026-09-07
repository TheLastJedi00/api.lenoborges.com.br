import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * A resposta do admin a um comentário (spec 023, decisão 2).
 *
 * **É um campo do comentário, e não um documento à parte.** A lista é plana por
 * decisão -- sem threads --, e uma coleção de respostas obrigaria a listagem a
 * costurar pai e filho em memória ou a pagar uma leitura por comentário para
 * devolver a mesma informação. Como campo, a resposta chega na mesma leitura que
 * o modal do membro já faz: sem consulta nova e sem índice novo.
 *
 * **Uma resposta por comentário, e responder de novo sobrescreve.** É a
 * consequência aceita de o campo ser um só, e ela é a certa para o que a tela
 * faz: o admin corrige o que escreveu, não conversa em fio.
 *
 * O `authorName` é o nome de quem respondeu, fotografado na hora -- mesma
 * decisão do `authorName` do comentário abaixo.
 */
export interface TrainingCommentReply {
  content: string;
  authorName: string;
  repliedAt: Date;
}

/**
 * Um comentário num desafio da Arena de Treinamento (spec 023, decisão 2).
 *
 * Coleção de primeiro nível `training_comments`, e não subcoleção de
 * `trainings/{id}`: o painel centralizado do admin lista **os comentários de
 * todos os treinamentos**, ordenados pelos mais recentes, e uma subcoleção
 * exigiria consulta de grupo de coleção para responder a pergunta mais simples
 * da tela. O vínculo é `trainingId`, como o de `trainings` com a insígnia.
 *
 * **O `authorName` é fotografado na criação**, como o da `MuralQuestion`: não
 * custa leitura por visita, sobrevive a uma troca de nome no perfil, e é o nome
 * de quem escreveu naquele dia -- não o que a pessoa virou depois.
 *
 * O `uid` fica no documento e **não sai no DTO público**: ele serve para apagar
 * o que é da pessoa quando ela pede para ser esquecida, e para nada mais na
 * tela.
 */
export interface TrainingComment {
  id: string;
  trainingId: string;
  uid: string;
  authorName: string;
  content: string;
  /** Nulo enquanto ninguém respondeu, que é o estado da grande maioria. */
  adminReply: TrainingCommentReply | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A resposta no Firestore: igual, com Timestamp no lugar de Date. */
interface TrainingCommentReplyDocument {
  content: string;
  authorName: string;
  repliedAt: Timestamp;
}

/** O que vai para o Firestore: sem `id`, que é o caminho, e com Timestamp. */
interface TrainingCommentDocument extends DocumentData {
  trainingId: string;
  uid: string;
  authorName: string;
  content: string;
  adminReply: TrainingCommentReplyDocument | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const trainingCommentConverter: FirestoreDataConverter<TrainingComment> =
  {
    toFirestore(comment: TrainingComment): TrainingCommentDocument {
      return {
        trainingId: comment.trainingId,
        uid: comment.uid,
        authorName: comment.authorName,
        content: comment.content,
        adminReply: comment.adminReply
          ? {
              content: comment.adminReply.content,
              authorName: comment.adminReply.authorName,
              repliedAt: Timestamp.fromDate(comment.adminReply.repliedAt),
            }
          : null,
        createdAt: Timestamp.fromDate(comment.createdAt),
        updatedAt: Timestamp.fromDate(comment.updatedAt),
      };
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): TrainingComment {
      const data = snapshot.data() as TrainingCommentDocument;

      return {
        id: snapshot.id,
        trainingId: data.trainingId,
        uid: data.uid,
        authorName: data.authorName,
        content: data.content,
        // `?? null`, e não é redundância com o `create` que sempre grava o
        // campo: um comentário escrito por um caminho que não passou por aqui
        // chega sem ele, e `undefined` num DTO de resposta derruba a listagem
        // inteira -- some o comentário de todo mundo por causa de um documento.
        adminReply: data.adminReply
          ? {
              content: data.adminReply.content,
              authorName: data.adminReply.authorName,
              repliedAt: data.adminReply.repliedAt.toDate(),
            }
          : null,
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
      };
    },
  };
