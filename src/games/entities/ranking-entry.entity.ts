import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';

/**
 * Uma linha do Ranking da Liga (spec 022, decisoes 11, 20 e 22).
 *
 * `ranking/{uid}` -- colecao dedicada, e nao um `getAll` em `profiles`. Tres
 * razoes, e nenhuma delas e "ficou mais bonito":
 *
 * 1. **Ler 200 perfis para montar um placar custa 200 leituras, toda vez.** Um
 *    ranking que cresce com a base custa proporcional a base; numa colecao
 *    dedicada a consulta e uma so.
 * 2. **O perfil tem dados que o ranking nao pode vazar** -- e-mail, telefone,
 *    tier, redes, aceites legais. Tudo viria junto, e o filtro teria que ser
 *    perfeito toda vez. Aqui sao poucos campos, e e tudo o que a tela precisa.
 * 3. **Ordenar por XP e um indice.** Nesta colecao ele e trivial; no perfil seria
 *    mais um indice composto num documento ja consultado por cinco caminhos.
 *
 * **E eventualmente consistente, e isso e aceito**: o XP do perfil pode estar um
 * passo a frente do ranking. Ele atualiza em segundos, nao em dias.
 *
 * **O nome exibido e o `nickname`, nunca o `name`** (decisao 20). Quem nao tem
 * gamertag nao entra no placar -- e por isso o backfill filtra por ele.
 */
export interface RankingEntry {
  uid: string;
  nickname: string;
  xp: number;
  /** Quantas insignias do GYM Battle, no teto de 8. */
  badgeCount: number;
  /**
   * A posicao de ontem, para o selo de "subiu 3 hoje" (decisao 22).
   *
   * `null` no primeiro dia, e a tela nao desenha selo nenhum nesse caso -- um
   * zero ali diria "nao mudou", que e uma afirmacao diferente de "ainda nao sei".
   */
  previousPosition: number | null;
  /** A posicao calculada no ultimo snapshot. Cache, nao verdade. */
  currentPosition: number | null;
  positionUpdatedAt: Date | null;
  updatedAt: Date;
}

interface RankingEntryDocument {
  uid: string;
  nickname: string;
  xp: number;
  badgeCount: number;
  previousPosition: number | null;
  currentPosition: number | null;
  positionUpdatedAt: Timestamp | null;
  updatedAt: Timestamp;
}

export const rankingEntryConverter: FirestoreDataConverter<RankingEntry> = {
  toFirestore(entry: RankingEntry): RankingEntryDocument {
    return {
      // O `uid` e o ID do documento **e** um campo, e a duplicacao e deliberada:
      // a ordenacao `xp DESC, uid ASC` precisa de `uid` como campo consultavel,
      // e `orderBy(documentId())` no Firestore ordena como texto num caminho
      // completo, que nao e a mesma coisa.
      uid: entry.uid,
      nickname: entry.nickname,
      xp: entry.xp,
      badgeCount: entry.badgeCount,
      previousPosition: entry.previousPosition,
      currentPosition: entry.currentPosition,
      positionUpdatedAt: entry.positionUpdatedAt
        ? Timestamp.fromDate(entry.positionUpdatedAt)
        : null,
      updatedAt: Timestamp.fromDate(entry.updatedAt),
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): RankingEntry {
    const data = snapshot.data() as Partial<RankingEntryDocument>;

    return {
      uid: data.uid ?? snapshot.id,
      // Sem gamertag o membro nao deveria estar aqui. Se estiver -- documento
      // escrito por um caminho que ninguem previu --, o placar mostra o vazio em
      // vez de `undefined`, que apareceria literalmente na tela.
      nickname: data.nickname ?? '',
      xp: data.xp ?? 0,
      badgeCount: data.badgeCount ?? 0,
      previousPosition: data.previousPosition ?? null,
      currentPosition: data.currentPosition ?? null,
      positionUpdatedAt: data.positionUpdatedAt?.toDate() ?? null,
      updatedAt: data.updatedAt?.toDate() ?? new Date(0),
    };
  },
};

/**
 * Quantas insignias contam para o placar.
 *
 * `min(grade, 8)`: a Elite Four e a Battle Frontier nao sao insignias do GYM
 * Battle, e conta-las faria quem esta no pos-game aparecer com 13 medalhas ao
 * lado de quem tem 8 -- comparando duas coisas diferentes na mesma coluna.
 */
export function badgeCountOf(grade: number): number {
  return Math.max(0, Math.min(grade, 8));
}
