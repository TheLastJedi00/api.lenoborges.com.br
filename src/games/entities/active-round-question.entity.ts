import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * Uma das dez questoes da rodada aberta (spec 022, decisao 8).
 *
 * `gym_challenges/{badgeId__uid}/active_round/{questionIndex}` -- o ID e o
 * indice, de `0` a `9`, e nao um id gerado: e por ele que o
 * `POST .../answer` encontra a questao que o membro respondeu, sem consulta e
 * sem o front precisar carregar um identificador que ele nao usa para mais nada.
 *
 * **`correctIndex` nao existe nesta subcolecao, e essa ausencia e o desenho.** A
 * resposta certa e conferida contra `gym_questions` quando a resposta chega;
 * copia-la para ca faria a cola caber numa unica leitura, e o Firestore nao
 * distingue "campo que o servidor le" de "campo que o cliente le" -- num dia em
 * que as `firestore.rules` afrouxassem, ou num endpoint novo que devolvesse o
 * documento inteiro, a prova viraria gabarito.
 *
 * **Efemera:** ao fim da rodada os dez documentos sao apagados. Se o membro
 * abandonar no meio, eles ficam -- e recomecar a rodada substitui a subcolecao
 * inteira, o que e o comportamento certo: as questoes sao sorteadas de novo.
 */
export interface ActiveRoundQuestion {
  /** O indice na rodada, de 0 a 9. E tambem o ID do documento. */
  index: number;
  /** A questao de origem, para conferir a resposta contra `gym_questions`. */
  questionId: string;
  /** A foto do enunciado: editar a questao nao muda o que esta na tela. */
  question: string;
  /** Ja embaralhadas pelo servidor. A ordem aqui e a ordem que o membro ve. */
  alternatives: string[];
  /**
   * Onde a certa foi parar depois do embaralhamento.
   *
   * **Isto nao e o `correctIndex` da questao**, e a diferenca importa: e a
   * posicao dela **nesta rodada**, e existe porque a resposta do `answer`
   * precisa dizer qual alternativa era a certa para a tela pintar de verde. Ela
   * so e gravada quando o membro **ja respondeu** -- ver `answeredAt`.
   */
  correctAlternativeIndex: number | null;
  servedAt: Date;
  answeredAt: Date | null;
  chosenIndex: number | null;
  correct: boolean | null;
  xpAwarded: number | null;
  /** O que o front cronometrou, em milissegundos (decisao 3). */
  clientElapsedMs: number | null;
}

interface ActiveRoundQuestionDocument {
  questionId: string;
  question: string;
  alternatives: string[];
  correctAlternativeIndex: number | null;
  servedAt: Timestamp;
  answeredAt: Timestamp | null;
  chosenIndex: number | null;
  correct: boolean | null;
  xpAwarded: number | null;
  clientElapsedMs: number | null;
}

export const activeRoundQuestionConverter: FirestoreDataConverter<ActiveRoundQuestion> =
  {
    toFirestore(entry: ActiveRoundQuestion): ActiveRoundQuestionDocument {
      return {
        questionId: entry.questionId,
        question: entry.question,
        alternatives: entry.alternatives,
        correctAlternativeIndex: entry.correctAlternativeIndex,
        servedAt: Timestamp.fromDate(entry.servedAt),
        answeredAt: entry.answeredAt
          ? Timestamp.fromDate(entry.answeredAt)
          : null,
        chosenIndex: entry.chosenIndex,
        correct: entry.correct,
        xpAwarded: entry.xpAwarded,
        clientElapsedMs: entry.clientElapsedMs,
      };
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): ActiveRoundQuestion {
      const data = snapshot.data() as ActiveRoundQuestionDocument;

      return {
        index: Number(snapshot.id),
        questionId: data.questionId,
        question: data.question,
        alternatives: data.alternatives,
        correctAlternativeIndex: data.correctAlternativeIndex ?? null,
        servedAt: data.servedAt.toDate(),
        answeredAt: data.answeredAt ? data.answeredAt.toDate() : null,
        chosenIndex: data.chosenIndex ?? null,
        // **`?? null` e nao `?? false`**: "ainda nao respondeu" e "respondeu
        // errado" sao coisas diferentes, e um `false` no lugar do nulo faria a
        // consolidacao contar como erradas as questoes que o membro nem viu.
        correct: data.correct ?? null,
        xpAwarded: data.xpAwarded ?? null,
        clientElapsedMs: data.clientElapsedMs ?? null,
      };
    },
  };
