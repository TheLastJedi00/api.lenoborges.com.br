import { Injectable } from '@nestjs/common';
import {
  CollectionReference,
  DocumentReference,
  Timestamp,
  WriteBatch,
} from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  RankingEntry,
  rankingEntryConverter,
} from './entities/ranking-entry.entity';

export const RANKING_COLLECTION = 'ranking';

/** O cursor de paginacao: a ultima linha da pagina anterior. */
export interface RankingCursor {
  xp: number;
  uid: string;
}

@Injectable()
export class RankingRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<RankingEntry> {
    return this.firebase.firestore
      .collection(RANKING_COLLECTION)
      .withConverter(rankingEntryConverter);
  }

  docRef(uid: string): DocumentReference<RankingEntry> {
    return this.collection.doc(uid);
  }

  /**
   * Uma pagina do placar, ordenada.
   *
   * **`xp DESC, uid ASC`, e o desempate nao e enfeite.** XP empata com
   * frequencia -- dois membros que assistiram aos mesmos videos tem o mesmo
   * numero --, e um `startAfter` sobre um campo nao unico **pula ou repete
   * linha** na pagina seguinte. O sintoma e um placar que perde alguem no meio
   * da rolagem, sem erro e com 200.
   *
   * Pede o indice composto `xp` desc + `uid` asc em producao.
   */
  async page({
    limit,
    after,
  }: {
    limit: number;
    after?: RankingCursor;
  }): Promise<{ entries: RankingEntry[] }> {
    let query = this.collection.orderBy('xp', 'desc').orderBy('uid', 'asc');

    if (after) {
      query = query.startAfter(after.xp, after.uid);
    }

    const snapshot = await query.limit(limit).get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  /** Tudo, para o snapshot diario recalcular as posicoes. */
  async listAll(): Promise<{ entries: RankingEntry[] }> {
    const snapshot = await this.collection
      .orderBy('xp', 'desc')
      .orderBy('uid', 'asc')
      .get();

    return { entries: snapshot.docs.map((document) => document.data()) };
  }

  async findByUid(
    uid: string,
  ): Promise<{ found: boolean; entry: RankingEntry | null }> {
    const snapshot = await this.collection.doc(uid).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Grava ou atualiza a linha do membro.
   *
   * **`set()` com merge dos campos de posicao preservados.** O `upsert` e
   * chamado a cada ganho de XP, e as posicoes so mudam no snapshot diario:
   * sobrescrever `previousPosition` com `null` aqui apagaria o selo de evolucao
   * de todo mundo que ganhasse XP no dia.
   */
  async upsert(entry: {
    uid: string;
    nickname: string;
    xp: number;
    badgeCount: number;
  }): Promise<RankingEntry> {
    const current = await this.findByUid(entry.uid);

    const next: RankingEntry = {
      ...entry,
      previousPosition: current.entry?.previousPosition ?? null,
      currentPosition: current.entry?.currentPosition ?? null,
      positionUpdatedAt: current.entry?.positionUpdatedAt ?? null,
      updatedAt: new Date(),
    };

    await this.collection.doc(entry.uid).set(next);

    return next;
  }

  /**
   * Soma XP na linha do placar dentro de um lote que ja existe.
   *
   * **Recebe o lote em vez de criar o proprio**, e e isso que faz o ranking
   * andar junto do perfil: quem paga o XP escreve as duas coisas de uma vez, e
   * um lote que falha nao deixa o placar a frente do perfil. Vale para o GYM
   * Challenge e para o `WatchedVideoRepository` da spec 019.
   *
   * **Nao usa `FieldValue.increment` e nao cria documento.** Increment num
   * documento inexistente o criaria sem `nickname`, e o placar ganharia uma
   * linha em branco de quem nunca escolheu gamertag -- exatamente quem a decisao
   * 20 mantem fora. Quem nao tem linha nao entra por aqui; entra pelo `upsert`,
   * depois de escolher o nome.
   */
  addXpToBatch(
    batch: WriteBatch,
    uid: string,
    exists: boolean,
    amount: number,
    currentXp: number,
  ): void {
    if (!exists || amount === 0) {
      return;
    }

    batch.update(this.docRef(uid), {
      xp: currentXp + amount,
      updatedAt: Timestamp.now(),
    });
  }

  /** Grava as posicoes recalculadas, em lotes de 400. */
  async savePositions(
    rows: {
      uid: string;
      currentPosition: number;
      previousPosition: number | null;
    }[],
  ): Promise<void> {
    // 400 e folga sobre o teto de 500 escritas por lote do Firestore. Um lote
    // que estoura o limite falha inteiro, e o snapshot de mil membros pararia
    // no meio deixando metade das posicoes de ontem e metade de hoje.
    const CHUNK = 400;

    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = this.firebase.firestore.batch();

      for (const row of rows.slice(i, i + CHUNK)) {
        batch.update(this.docRef(row.uid), {
          currentPosition: row.currentPosition,
          previousPosition: row.previousPosition,
          positionUpdatedAt: Timestamp.now(),
        });
      }

      await batch.commit();
    }
  }

  async remove(uid: string): Promise<void> {
    await this.collection.doc(uid).delete();
  }
}
