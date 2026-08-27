import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  FieldValue,
  Timestamp,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  ANONYMOUS_AUTHOR_NAME,
  ANONYMOUS_AUTHOR_UID,
  MuralQuestion,
  muralQuestionConverter,
  questionDocId,
} from './entities/mural-question.entity';
import { muralVoteConverter } from './entities/mural-vote.entity';

export const MURAL_COLLECTION = 'mural_questions';
export const VOTE_SUBCOLLECTION = 'votes';

/**
 * Quem venceu uma semana, entre as perguntas dela.
 *
 * Pura e exportada porque tem **um dono só**: a pauta escolhe a vencedora sobre
 * o array que já carregou, e uma segunda implementação do desempate divergiria
 * na primeira semana com empate.
 *
 * O corte de `promotedTo` é aqui, em memória, e nunca numa cláusula `where`.
 * Ver o comentário de `findWinner`.
 */
export function winnerOf(questions: MuralQuestion[]): MuralQuestion | null {
  return questions
    .filter((question) => question.promotedTo === null)
    .reduce<MuralQuestion | null>((melhor, atual) => {
      if (!melhor) {
        return atual;
      }

      if (atual.voteCount !== melhor.voteCount) {
        return atual.voteCount > melhor.voteCount ? atual : melhor;
      }

      return atual.createdAt < melhor.createdAt ? atual : melhor;
    }, null);
}

export type CreateQuestionData = Pick<
  MuralQuestion,
  'weekId' | 'badgeId' | 'authorUid' | 'authorName' | 'title' | 'body'
>;

@Injectable()
export class MuralRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<MuralQuestion> {
    return this.firebase.firestore
      .collection(MURAL_COLLECTION)
      .withConverter(muralQuestionConverter);
  }

  /**
   * Perguntas de uma semana.
   *
   * `byVotes` ordena por `voteCount desc` — a semana em votação — e o padrão
   * ordena por `createdAt`, que é a da coleta: lá o voto ainda não abriu, e
   * ordenar por um contador zerado seria ordenar por nada.
   *
   * **Esta consulta pede índice composto no Firestore de produção**
   * (`weekId` + `voteCount`, e `weekId` + `createdAt`). O emulador não exige
   * índice, então a suíte passa verde e a falha só aparece no primeiro acesso
   * real, com um link no erro que ninguém está esperando.
   *
   * `newestFirst` inverte a coleta para a mais nova primeiro, que é como o Mural
   * abre para quem chegou por uma notificação de pergunta nova (spec 012): a
   * ordem padrão põe a anunciada no fim de tudo. **Não pede índice novo** —
   * inverter todas as direções de uma consulta ordenada usa o mesmo índice, e
   * este é `weekId` + `createdAt`, que já existe. Abrir chamado para criar um
   * índice por causa desta linha é trabalho para nada.
   */
  async listByWeek(
    weekId: string,
    byVotes: boolean,
    newestFirst = false,
  ): Promise<MuralQuestion[]> {
    const query = byVotes
      ? this.collection
          .where('weekId', '==', weekId)
          .orderBy('voteCount', 'desc')
          .orderBy('createdAt', 'asc')
      : this.collection
          .where('weekId', '==', weekId)
          .orderBy('createdAt', newestFirst ? 'desc' : 'asc');

    const snapshot = await query.get();
    return snapshot.docs.map((document) => document.data());
  }

  /**
   * A vencedora de uma semana: maior `voteCount`, desempate pela mais antiga,
   * **entre as que não foram adiantadas** (spec 016, decisão 3).
   *
   * **Derivada, nunca gravada.** Ninguém promove a vencedora, e por isso ela
   * não tem como ficar errada nem precisar ser mantida em dia. O desempate
   * precisa ser determinístico, ou duas telas mostram vencedoras diferentes
   * para o mesmo estado.
   *
   * A pergunta adiantada fica fora da conta porque a exposição dela é outra:
   * promovida a `votacao` na semana N, ela recebe voto durante a semana N pelo
   * piso e durante a N+1 pela conta natural — até 14 dias contra 7 de todas as
   * outras. Deixá-la competir transformaria "a mais votada" em "a que o admin
   * adiantou".
   *
   * **O corte é em memória, e não um `where('promotedTo', '==', null)`.** Essa
   * consulta quebraria em silêncio: no Firestore, `== null` casa com o
   * documento em que o campo existe e vale null, e **não** com o documento que
   * não tem o campo — e toda pergunta escrita antes da spec 016 não tem. O
   * histórico de vencedoras apareceria vazio para todas as semanas anteriores,
   * sem erro nenhum, com a resposta 200.
   *
   * Custo real zero: uma semana tem dezenas de perguntas, não milhares. E a
   * semana inteira volta junto, para a pauta tirar as adiantadas dela **sem uma
   * consulta nova e sem um índice novo** (decisão 5).
   */
  async findWinner(weekId: string): Promise<{
    found: boolean;
    entry: MuralQuestion | null;
    questions: MuralQuestion[];
  }> {
    const questions = await this.listByWeek(weekId, true);
    const winner = winnerOf(questions);

    return { found: winner !== null, entry: winner, questions };
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: MuralQuestion | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /** A pergunta de alguém numa semana. Leitura por caminho, sem consulta. */
  async findMine(
    weekId: string,
    uid: string,
  ): Promise<{ found: boolean; entry: MuralQuestion | null }> {
    return this.findById(questionDocId(weekId, uid));
  }

  async create(data: CreateQuestionData): Promise<{ entry: MuralQuestion }> {
    const now = new Date();
    const id = questionDocId(data.weekId, data.authorUid);
    const entry: MuralQuestion = {
      ...data,
      id,
      voteCount: 0,
      answerVideoId: null,
      // Nasce sem adiantamento. Gravar `null` explicito e ler `?? null` dao o
      // mesmo resultado -- e por isso que a decisao 4 da spec 016 corta em
      // memoria: o documento anterior a ela nao tem o campo, e nenhuma consulta
      // por `== null` enxerga os dois casos.
      promotedTo: null,
      createdAt: now,
      updatedAt: now,
    };

    // create(), nunca set(): é o ALREADY_EXISTS daqui que faz o caminho
    // `{weekId}__{uid}` valer como a garantia de uma pergunta por semana.
    await this.collection.doc(id).create(entry);

    return { entry };
  }

  async update(
    id: string,
    data: Partial<
      Pick<MuralQuestion, 'title' | 'body' | 'answerVideoId' | 'promotedTo'>
    >,
  ): Promise<{ entry: MuralQuestion }> {
    const ref = this.collection.doc(id);
    await ref.update({ ...data, updatedAt: Timestamp.now() });

    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Pergunta ${id} nao encontrada apos o update.`);
    }

    return { entry: snapshot.data()! };
  }

  /**
   * Quais destas perguntas o usuário já votou.
   *
   * `getAll` por caminho, e não uma consulta por autor: o voto é endereçado por
   * `{questionId}/votes/{uid}`, então saber isso não custa índice nenhum. Sem
   * esta leitura, o front não sabe qual coração pintar e a tela pisca a cada
   * recarga.
   */
  async findMyVotes(questionIds: string[], uid: string): Promise<Set<string>> {
    if (questionIds.length === 0) {
      return new Set();
    }

    const refs = questionIds.map((questionId) =>
      this.collection.doc(questionId).collection(VOTE_SUBCOLLECTION).doc(uid),
    );

    const snapshots = await this.firebase.firestore.getAll(...refs);

    const voted = new Set<string>();
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        voted.add(questionIds[index]);
      }
    });

    return voted;
  }

  /**
   * Vota, ou desfaz o voto, **num lote atômico**.
   *
   * As duas operações — o documento do voto e o `increment` do contador — vão no
   * mesmo `WriteBatch`. Se o voto já existe, o `create()` falha e o lote inteiro
   * falha junto: o contador não se mexe, que é exatamente a proteção contra
   * contar duas vezes.
   *
   * **Nunca ler-somar-escrever.** Duas pessoas votando no mesmo segundo
   * perderiam um voto, e o erro seria invisível — o número simplesmente ficaria
   * menor do que deveria.
   */
  async vote(questionId: string, uid: string): Promise<void> {
    const batch = this.firebase.firestore.batch();
    const question = this.collection.doc(questionId);
    const vote = question
      .collection(VOTE_SUBCOLLECTION)
      .withConverter(muralVoteConverter)
      .doc(uid);

    batch.create(vote, { id: uid, votedAt: new Date() });
    batch.update(question, {
      voteCount: FieldValue.increment(1),
      updatedAt: Timestamp.now(),
    });

    await batch.commit();
  }

  async unvote(questionId: string, uid: string): Promise<void> {
    const batch = this.firebase.firestore.batch();
    const question = this.collection.doc(questionId);
    const vote = question.collection(VOTE_SUBCOLLECTION).doc(uid);

    batch.delete(vote);
    batch.update(question, {
      voteCount: FieldValue.increment(-1),
      updatedAt: Timestamp.now(),
    });

    await batch.commit();
  }

  async hasVoted(questionId: string, uid: string): Promise<boolean> {
    const snapshot = await this.collection
      .doc(questionId)
      .collection(VOTE_SUBCOLLECTION)
      .doc(uid)
      .get();

    return snapshot.exists;
  }

  /**
   * Tira o autor das perguntas de alguem, sem apagar as perguntas (spec 013).
   *
   * `authorUid` vira `ANONYMOUS_AUTHOR_UID` e `authorName` vira
   * `ANONYMOUS_AUTHOR_NAME`, num lote so. **Texto, `badgeId`, `voteCount` e
   * `answerVideoId` ficam intactos**: os votos sao de outras pessoas e o video
   * de resposta ja foi publicado respondendo aquilo.
   *
   * Consequencia que vale registrar: depois desta escrita, **`authorUid` deixa
   * de ser garantia de que existe um perfil por tras dele**. Quem cruzar os dois
   * precisa tolerar a ausencia.
   */
  async anonymizeAuthor(uid: string): Promise<number> {
    const snapshot = await this.collection.where('authorUid', '==', uid).get();

    if (snapshot.empty) {
      return 0;
    }

    const batch = this.firebase.firestore.batch();
    for (const document of snapshot.docs) {
      batch.update(document.ref, {
        authorUid: ANONYMOUS_AUTHOR_UID,
        authorName: ANONYMOUS_AUTHOR_NAME,
        updatedAt: Timestamp.now(),
      });
    }

    await batch.commit();

    return snapshot.size;
  }

  /**
   * Apaga os votos que alguem deu, **decrementando os contadores no mesmo lote**.
   *
   * O `uid` esta no caminho do voto -- `{questionId}/votes/{uid}` --, entao ele
   * sai junto com a conta. E o `voteCount` acompanha: contador que discorda da
   * subcolecao e um numero que ninguem consegue conferir depois.
   *
   * **Achar os votos e varredura, nao consulta**, e isso e escolha. Nao existe
   * consulta que devolva "todos os votos deste uid" sem indice de collection
   * group, e criar esse indice e pagar custo mensal por um evento que acontece
   * uma vez na vida de cada membro. `mural_questions` e pequena por construcao
   * -- uma pergunta por membro por semana --, e a leitura e o mesmo `getAll` por
   * caminho que o `findMyVotes` ja faz.
   *
   * O numero a olhar quando isto incomodar esta no ponto em aberto 4 da spec
   * 013: com cem membros ativos por um ano sao cinco mil documentos.
   */
  async removeVotesBy(uid: string): Promise<number> {
    const questions = await this.collection.listDocuments();

    if (questions.length === 0) {
      return 0;
    }

    const voteRefs = questions.map((question) =>
      question.collection(VOTE_SUBCOLLECTION).doc(uid),
    );
    const snapshots = await this.firebase.firestore.getAll(...voteRefs);

    const batch = this.firebase.firestore.batch();
    let removed = 0;

    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        return;
      }

      removed += 1;
      batch.delete(snapshot.ref);
      batch.update(questions[index], {
        voteCount: FieldValue.increment(-1),
        updatedAt: Timestamp.now(),
      });
    });

    if (removed === 0) {
      return 0;
    }

    await batch.commit();

    return removed;
  }

  /**
   * Apaga a pergunta **e os votos dela**.
   *
   * Subcoleção não desaparece com o pai no Firestore — o documento some e os
   * votos ficam órfãos, invisíveis e cobrados. É a pegadinha clássica, e é o
   * motivo de a remoção não ser um `delete()` sozinho.
   */
  async remove(questionId: string): Promise<void> {
    const question = this.collection.doc(questionId);
    const votes = await question.collection(VOTE_SUBCOLLECTION).listDocuments();

    const batch = this.firebase.firestore.batch();
    for (const vote of votes) {
      batch.delete(vote);
    }
    batch.delete(question);

    await batch.commit();
  }
}
