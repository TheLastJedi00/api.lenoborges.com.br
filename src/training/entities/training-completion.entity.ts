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
 *
 * **`hintsUsed` está aqui pelo mesmo motivo, e é o que explica o valor pago**
 * (spec 025). Sem ele, uma auditoria olha um desafio de 30 que pagou 27 e não
 * tem como saber se houve desconto de três dicas ou um erro de cálculo. Ele é
 * gravado "como cobrado", nunca recontado: o admin pode editar as dicas do
 * desafio depois, e recontar a partir do treinamento de hoje acusaria a mesma
 * divergência inventada.
 *
 * **Ele não é a trava de repetição.** Quem impede o segundo pagamento continua
 * sendo o `ALREADY_EXISTS` do caminho, e na segunda chamada nada é escrito: o
 * `hintsUsed` gravado segue sendo o da primeira, com `xpAwarded: 0` na resposta.
 */
export interface TrainingCompletion {
  id: string;
  uid: string;
  trainingId: string;
  xpAwarded: number;
  /** Quantas dicas foram cobradas nesta conclusão (spec 025). */
  hintsUsed: number;
  /**
   * O codigo que o membro colou ao concluir, ou nulo (spec 027).
   *
   * **E a prova do que foi entregue, e e o que o admin abre para conferir.** Nao
   * participa da trava de repeticao e nao muda o XP: quem impede o segundo
   * pagamento continua sendo o `ALREADY_EXISTS` do caminho.
   *
   * **A consequencia disso e que a submissao gravada e a da primeira chamada.**
   * Concluir de novo nao escreve nada -- nem o XP, nem estes campos --, entao um
   * segundo envio com codigo diferente nao substitui o primeiro. Nao existe
   * "reenviar a resposta", e a tela nao oferece isso.
   */
  mainCode: string | null;
  /**
   * A foto do resultado, URL do nosso bucket ou nulo (spec 027).
   *
   * **Exclusiva do Great Dev Tier em diante**, conferido no service antes de o
   * arquivo entrar no bucket e outra vez na conclusao -- a rota de upload e o
   * `complete` sao duas chamadas, e a segunda tambem confere que a URL e uma
   * que esta API cunhou para este membro.
   *
   * Mesma regra do `mainCode` quanto a repeticao: fica a da primeira.
   */
  resultImageUrl: string | null;
  completedAt: Date;
}

interface TrainingCompletionDocument extends DocumentData {
  uid: string;
  trainingId: string;
  xpAwarded: number;
  hintsUsed: number;
  mainCode: string | null;
  resultImageUrl: string | null;
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
        hintsUsed: completion.hintsUsed,
        mainCode: completion.mainCode,
        resultImageUrl: completion.resultImageUrl,
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
        // Toda conclusão anterior à spec 025 chega sem o campo, e zero é a
        // verdade sobre ela: naquele dia não havia dica a revelar.
        hintsUsed: data.hintsUsed ?? 0,
        // Toda conclusao anterior a spec 027 chega sem os campos, e `null` e a
        // verdade sobre ela: naquele dia nao havia o que enviar.
        mainCode: data.mainCode ?? null,
        resultImageUrl: data.resultImageUrl ?? null,
        completedAt: data.completedAt.toDate(),
      };
    },
  };
