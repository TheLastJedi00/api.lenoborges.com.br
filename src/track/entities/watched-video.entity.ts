import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * O registro de que um membro assistiu a um video da trilha (spec 019).
 *
 * Mora em `profiles/{uid}/watched_videos/{videoId}`, e o ID do documento e o ID
 * do video -- `{badgeId}__{youtubeId}` --, que carrega a garantia de sempre: o
 * mesmo video nao entra duas vezes, porque o `create()` falha com
 * ALREADY_EXISTS.
 *
 * **Este documento e um razao, e nao um estado**, e a diferenca e a decisao 2 da
 * spec inteira. Ele guarda dois fatos que parecem um so:
 *
 * - `watched` e o check da tela. Muda quantas vezes o membro quiser.
 * - `firstWatchedAt` e **imutavel**, e e o fato que concedeu os 10 XP. Nenhum
 *   caminho do codigo o reescreve.
 *
 * A razao de existirem separados: **desmarcar nao devolve XP**. Se desmarcar
 * apagasse o documento, remarcar concederia 10 XP de novo, e o farm seria um
 * duplo clique repetido -- sem bug, sem exploracao, usando a tela exatamente
 * como ela foi desenhada. Entao o documento nao e apagado nunca, e
 * `watched: false` e o que substitui o `delete` que alguem vai querer escrever.
 *
 * A propriedade que sai dai e a que torna o `xp` do perfil conferivel:
 *
 * > **XP = XP_PER_VIDEO x (numero de documentos nesta subcolecao)**, sempre,
 * > independente de quantos estao marcados agora.
 *
 * Um contador que so sabe somar nao tem com o que ser comparado; este tem, e a
 * comparacao e um teste.
 */
export interface WatchedVideo {
  /** O ID do video da trilha. E o caminho do documento. */
  videoId: string;
  /**
   * A insignia do video, **copiada do documento do video na primeira marcacao**.
   *
   * Nao vem de partir o `videoId` em pedacos. O ID e `{badgeId}__{youtubeId}`
   * hoje, e quem escrever um `split` aqui assina que ele sera sempre assim.
   */
  badgeId: string;
  /** O check de agora. Livre para ir e voltar. */
  watched: boolean;
  /** **Imutavel.** Existe documento, entao o XP daquele video ja foi pago. */
  firstWatchedAt: Date;
  updatedAt: Date;
}

/** O que vai para o Firestore: sem `videoId`, que e o caminho, e com Timestamp. */
interface WatchedVideoDocument extends DocumentData {
  badgeId: string;
  watched: boolean;
  firstWatchedAt: Timestamp;
  updatedAt: Timestamp;
}

export const watchedVideoConverter: FirestoreDataConverter<WatchedVideo> = {
  toFirestore(watched: WatchedVideo): WatchedVideoDocument {
    return {
      badgeId: watched.badgeId,
      watched: watched.watched,
      firstWatchedAt: Timestamp.fromDate(watched.firstWatchedAt),
      updatedAt: Timestamp.fromDate(watched.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): WatchedVideo {
    const data = snapshot.data() as WatchedVideoDocument;

    return {
      videoId: snapshot.id,
      badgeId: data.badgeId,
      // Nao ha documento anterior a esta spec nesta subcolecao -- ela nasce com
      // ela --, mas o `?? true` cobre o unico caso real: um documento gravado
      // por um caminho futuro que esqueca o campo. Existir o documento ja
      // significa que o XP foi pago, e o check acompanhar isso e o padrao menos
      // surpreendente.
      watched: data.watched ?? true,
      firstWatchedAt: data.firstWatchedAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
    };
  },
};
