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

/**
 * A lista em que o video aparece (spec 021).
 *
 * **`kind` e a natureza do video, `tab` e o endereco dele.** Ate a spec 021 um
 * campo so fazia as duas coisas, porque elas andavam juntas: resposta tinha
 * balao E vivia na aba de respostas. Agora uma resposta posicionada na trilha
 * **continua sendo resposta** -- continua com a pergunta fotografada, continua
 * em `retrato`, continua abrindo o balao -- e **passa a viver na lista das
 * aulas**.
 *
 * **Nao e um booleano `naTrilha`, e a razao e a consulta.** Com um booleano, a
 * listagem da trilha viraria `kind == 'aula'` OU `naTrilha == true`, e uma
 * disjuncao com `orderBy` no Firestore custa indice novo e plano imprevisivel.
 * Com `tab`, a consulta e a de hoje com outro nome de campo:
 * `where('badgeId').where('tab').orderBy('order')`. E `naTrilha: false` num
 * video que esta na trilha de respostas e a frase que confunde a proxima pessoa.
 */
export type BadgeVideoTab = 'aula' | 'resposta';

/**
 * A pergunta que o video responde, **fotografada na publicacao** (spec 017).
 *
 * Nao e redundante com o `questionId` ao lado dela, e nao e cache: e a mesma
 * escolha que a `MuralQuestion` ja fez com o `authorName` dela, por tres motivos
 * que se somam.
 *
 * **1. Nao custa leitura por visita.** A alternativa era um `getAll` sobre os
 * `questionId` a cada `listByBadge` -- uma leitura a mais por resposta listada,
 * toda vez que alguem abre a aba. Aqui a leitura acontece uma vez, na
 * publicacao.
 *
 * **2. Sobrevive a remocao da pergunta.** O admin pode apagar uma pergunta do
 * mural, e o video publicado continua no ar. Com juncao, o balao sumiria junto e
 * sobraria um video de resposta que ninguem entende.
 *
 * **3. E o que foi perguntado, e nao o que a pergunta virou.** O autor pode
 * editar a pergunta enquanto ela esta em coleta (spec 016), e o video respondeu
 * a versao antiga. A foto e o registro certo.
 *
 * O preco esta aceito e declarado: editar a pergunta depois nao muda o balao.
 */
export interface AnsweredQuestion {
  id: string;
  title: string;
  authorName: string;
  /**
   * O `createdAt` da **pergunta**, nunca o do video.
   *
   * Sao datas diferentes e a que interessa ao balao e a primeira: ele diz "isto
   * foi perguntado em tal dia", e a data em que o video foi gravado nao e
   * informacao de ninguem.
   */
  askedAt: Date;
}

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
  /**
   * A lista em que o video vive (spec 021). Nao e a natureza dele -- essa
   * continua sendo `kind`.
   *
   * Toda aula tem `tab: 'aula'`. Uma resposta tem `tab: 'resposta'` por padrao,
   * e `tab: 'aula'` quando o admin marcou o toggle na publicacao. Os dois campos
   * divergem em exatamente um caso, e e o que a spec 021 existe para permitir.
   *
   * **Toda consulta e toda renormalizacao de ordem sao por `tab`**;
   * `orientation` continua saindo de `kind`.
   */
  tab: BadgeVideoTab;
  /** A pergunta que originou a resposta. Nulo em toda aula. */
  questionId: string | null;
  /**
   * A foto da pergunta, para a tela desenhar o balao sem uma segunda leitura.
   *
   * Nulo em toda aula e em **todo video anterior a spec 017** -- inclusive nos
   * que tiverem `kind: 'resposta'`, se algum existir. Quem consome desenha o
   * balao quando ele existe e nao desenha quando nao existe.
   */
  question: AnsweredQuestion | null;
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
   * A renormalizacao acontece dentro de `(badgeId, tab)`, e nao da insignia
   * inteira: uma insignia com tres aulas e duas respostas tem duas sequencias
   * independentes. Renormalizar sem separar por `tab` embaralharia as duas
   * abas de uma vez -- e e o bug mais provavel de toda esta familia.
   *
   * O eixo era `(badgeId, kind)` ate a spec 021, e a troca e so de eixo: e a
   * mesma garantia, sobre a lista certa. Uma resposta posicionada na trilha
   * ocupa uma posicao **da trilha**, e nao da aba de respostas.
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
  tab: BadgeVideoTab;
  questionId: string | null;
  question: AnsweredQuestionDocument | null;
  devTierFree: boolean;
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A foto no Firestore: igual a entidade, com Timestamp no lugar de Date. */
interface AnsweredQuestionDocument {
  id: string;
  title: string;
  authorName: string;
  askedAt: Timestamp;
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
      tab: video.tab,
      questionId: video.questionId,
      question: video.question
        ? {
            id: video.question.id,
            title: video.question.title,
            authorName: video.question.authorName,
            askedAt: Timestamp.fromDate(video.question.askedAt),
          }
        : null,
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
      // Documento anterior a spec 021 nao tem `tab`, e **le a lista em que ja
      // estava**: o `kind` dele.
      //
      // **Isto e o cinto de seguranca da LEITURA, e nao a migracao.** O
      // `where('tab', '==', 'aula')` nao enxerga documento sem o campo -- ele
      // nunca e devolvido, logo nunca chega aqui, logo nunca ganha o padrao.
      // Quem torna a base consultavel e o `scripts/backfill-tab.ts`, e sem ele
      // a trilha responde **lista vazia com 200**: some inteira, sem ninguem
      // ter apagado nada. A decisao 2 da spec dizia o contrario e foi corrigida
      // depois de medir contra o Firestore real.
      //
      // O que este fallback ainda garante: um documento escrito por um caminho
      // que ninguem previu le a lista certa em vez de `undefined`.
      tab: data.tab ?? data.kind ?? 'aula',
      questionId: data.questionId ?? null,
      // Documento anterior a spec 017 nao tem a foto, e le como null: a tela
      // desenha o balao quando ele existe e nao reserva espaco quando nao.
      question: data.question
        ? {
            id: data.question.id,
            title: data.question.title,
            authorName: data.question.authorName,
            askedAt: data.question.askedAt.toDate(),
          }
        : null,
      devTierFree: data.devTierFree ?? false,
      order: data.order,
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
