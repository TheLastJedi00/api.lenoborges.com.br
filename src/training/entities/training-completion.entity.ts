import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * A prova de que um membro concluiu um desafio, e de quanto isso pagou
 * (spec 023, decisão 3).
 *
 * **O ID do documento é `{uid}__{trainingId}`**, e o caminho carrega a garantia
 * -- como `gym_challenges/{badgeId}__{uid}`, como `badge_videos`, como
 * `waitlist_entries/{email}`. O Firestore não tem `UNIQUE`, e é o
 * `ALREADY_EXISTS` de um `create()` sobre caminho ocupado que impede o mesmo
 * desafio de pagar XP duas vezes -- **sem transação, sem leitura prévia e sem
 * janela entre conferir e escrever**.
 *
 * **O documento nunca é apagado por vontade do membro**, e é o que separa esta
 * coleção de um estado com interruptor. Não existe "desconcluir": se existisse,
 * reconcluir pagaria de novo, e o farm seria um duplo clique usando a tela
 * exatamente como ela foi desenhada. Ele só some quando a conta é excluída ou
 * quando o treinamento deixa de existir.
 *
 * **`xpAwarded` é gravado, e não recalculado.** O admin pode editar o
 * `xpAmount` do desafio depois -- de 30 para 50 --, e o que este documento
 * registra é o que **foi pago naquele dia**. Sem ele, uma auditoria do XP
 * somaria o valor de hoje sobre conclusões de ontem e acusaria uma divergência
 * que nunca existiu.
 */
export interface TrainingCompletion {
  id: string;
  uid: string;
  trainingId: string;
  xpAwarded: number;
  completedAt: Date;
}

interface TrainingCompletionDocument extends DocumentData {
  uid: string;
  trainingId: string;
  xpAwarded: number;
  completedAt: Timestamp;
}

/** Monta o ID do documento. Existe aqui para a regra ter um dono só. */
export function trainingCompletionDocId(
  uid: string,
  trainingId: string,
): string {
  return `${uid}__${trainingId}`;
}

export const trainingCompletionConverter: FirestoreDataConverter<TrainingCompletion> =
  {
    toFirestore(completion: TrainingCompletion): TrainingCompletionDocument {
      return {
        uid: completion.uid,
        trainingId: completion.trainingId,
        xpAwarded: completion.xpAwarded,
        completedAt: Timestamp.fromDate(completion.completedAt),
      };
    },

    fromFirestore(snapshot: QueryDocumentSnapshot): TrainingCompletion {
      const data = snapshot.data() as TrainingCompletionDocument;

      return {
        id: snapshot.id,
        uid: data.uid,
        trainingId: data.trainingId,
        // `?? 0` e não `?? DEFAULT_TRAINING_XP`: um documento sem o campo é uma
        // conclusão de que não se sabe o valor, e chutar o padrão inventaria XP
        // numa auditoria. Zero diz "não sei", que é a verdade.
        xpAwarded: data.xpAwarded ?? 0,
        completedAt: data.completedAt.toDate(),
      };
    },
  };
