import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import { BadgeId } from '../../track/track.constants';
import { Difficulty } from '../games.constants';

/**
 * Uma questao do banco do GYM Challenge (spec 022, decisao 6).
 *
 * **Colecao de primeiro nivel, e nao subcolecao de `badge_videos`.** Questao
 * vive mais que video: um video pode ser removido sem afetar o desafio, e o
 * desafio pode existir antes de qualquer video estar publicado. O vinculo e o
 * `badgeId`, que e a insignia, e nada mais -- pendurar a questao no video faria
 * apagar uma aula levar embora as perguntas sobre ela.
 *
 * **O ID e automatico, e esta e a primeira colecao da spec em que ele e.** Em
 * `waitlist_entries/{email}`, `profiles/{uid}` e `badge_videos/{badgeId__ytId}`
 * o caminho carrega uma garantia de unicidade; aqui nao ha nenhuma para
 * carregar. Duas questoes com o mesmo enunciado na mesma insignia sao um erro de
 * revisao, nao de integridade -- e transformar o enunciado em ID tornaria
 * corrigir uma virgula uma exclusao seguida de uma criacao, perdendo a data.
 *
 * **`correctIndex` e numero, nunca a string da alternativa certa.** A resposta e
 * uma posicao, e a posicao muda quando o servidor embaralha as alternativas para
 * servir a rodada -- quem embaralha carrega o indice junto, e a comparacao
 * acontece sempre aqui dentro, contra este documento. Guardar a string faria a
 * conferencia virar comparacao de texto, e a primeira alternativa reescrita com
 * um acento diferente passaria a estar errada para sempre, em silencio.
 *
 * **Este documento nunca sai inteiro para o membro.** O que ele recebe e o
 * `RoundQuestionDto`, sem `correctIndex`: num questionario, a resposta certa
 * trafegando e cola.
 */
export interface GymQuestion {
  id: string;
  badgeId: BadgeId;
  difficulty: Difficulty;
  question: string;
  /** Exatamente quatro. A validacao mora no DTO e no service. */
  alternatives: string[];
  /** 0, 1, 2 ou 3 -- a posicao da certa dentro de `alternatives`. */
  correctIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A foto no Firestore: igual a entidade, com Timestamp no lugar de Date. */
interface GymQuestionDocument {
  badgeId: BadgeId;
  difficulty: Difficulty;
  question: string;
  alternatives: string[];
  correctIndex: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const gymQuestionConverter: FirestoreDataConverter<GymQuestion> = {
  toFirestore(entry: GymQuestion): GymQuestionDocument {
    return {
      badgeId: entry.badgeId,
      difficulty: entry.difficulty,
      question: entry.question,
      alternatives: entry.alternatives,
      correctIndex: entry.correctIndex,
      createdAt: Timestamp.fromDate(entry.createdAt),
      updatedAt: Timestamp.fromDate(entry.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): GymQuestion {
    const data = snapshot.data() as GymQuestionDocument;

    return {
      id: snapshot.id,
      badgeId: data.badgeId,
      difficulty: data.difficulty,
      question: data.question,
      // **Nao ha fallback util aqui, e por isso ele nao existe.** Um `?? []`
      // faria uma questao corrompida ser servida numa rodada sem alternativa
      // nenhuma, e o membro veria um enunciado com quatro botoes vazios. Uma
      // questao sem alternativas nao tem leitura correta; se este campo faltar,
      // e melhor estourar aqui do que fingir.
      alternatives: data.alternatives,
      correctIndex: data.correctIndex,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
