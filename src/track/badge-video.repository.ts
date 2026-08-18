import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  BadgeVideo,
  BadgeVideoKind,
  badgeVideoConverter,
  badgeVideoDocId,
} from './entities/badge-video.entity';
import { BadgeId } from './track.constants';

export const BADGE_VIDEO_COLLECTION = 'badge_videos';

/** Campos que o chamador informa ao criar; o resto o repository preenche. */
export type CreateBadgeVideoData = Pick<
  BadgeVideo,
  'badgeId' | 'title' | 'description' | 'youtubeId' | 'order'
> & {
  /** Sem valor, o video nasce como aula: e o que quase todo video e. */
  kind?: BadgeVideoKind;
  questionId?: string | null;
  devTierFree?: boolean;
};

@Injectable()
export class BadgeVideoRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<BadgeVideo> {
    return this.firebase.firestore
      .collection(BADGE_VIDEO_COLLECTION)
      .withConverter(badgeVideoConverter);
  }

  /**
   * Vídeos de uma insignia, ja na ordem.
   *
   * **A ordenacao e do servidor**, e nao do service depois de ler: ordenar aqui
   * e o que faz a lista ser a mesma para todo mundo, independente de quem a leu.
   *
   * `kind` filtra a aba (spec 010): Aulas e Perguntas Frequentes sao duas listas
   * com propositos diferentes, e a ordem de cada uma e propria. Sem filtro,
   * devolve as duas juntas -- que e o que a administracao precisa.
   *
   * Esta consulta pede um indice composto (`badgeId` + `order`, e
   * `badgeId` + `kind` + `order`) no Firestore de producao. Ele nao existe
   * sozinho, e o primeiro acesso real falha com um erro que traz o link para
   * cria-lo -- o emulador nao exige indice, entao a suite passa verde ate la.
   */
  async listByBadge(
    badgeId: BadgeId,
    kind?: BadgeVideoKind,
  ): Promise<BadgeVideo[]> {
    const base = this.collection.where('badgeId', '==', badgeId);
    const query = kind ? base.where('kind', '==', kind) : base;

    const snapshot = await query.orderBy('order').get();

    return snapshot.docs.map((document) => document.data());
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: BadgeVideo | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  async create(data: CreateBadgeVideoData): Promise<{ entry: BadgeVideo }> {
    const now = new Date();
    const id = badgeVideoDocId(data.badgeId, data.youtubeId);
    const entry: BadgeVideo = {
      kind: 'aula',
      questionId: null,
      devTierFree: false,
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    // create(), nunca set(): e o ALREADY_EXISTS daqui que faz o caminho composto
    // valer como a unicidade que ele promete. set() sobrescreveria o video
    // existente em silencio, e o sintoma seria um titulo trocado sem autor.
    await this.collection.doc(id).create(entry);

    return { entry };
  }

  async update(
    id: string,
    data: Partial<Pick<BadgeVideo, 'title' | 'description' | 'order'>>,
  ): Promise<{ entry: BadgeVideo }> {
    const ref = this.collection.doc(id);

    await ref.update({ ...data, updatedAt: Timestamp.now() });

    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Video ${id} nao encontrado apos o update.`);
    }

    return { entry: snapshot.data()! };
  }

  async delete(id: string): Promise<void> {
    await this.collection.doc(id).delete();
  }

  /**
   * Grava as posicoes 0..n-1 na ordem recebida, **num lote atomico**.
   *
   * Ou entram todas as posicoes ou nenhuma. Um `update` por video deixaria a
   * lista com dois videos no mesmo `order` se a segunda escrita falhasse, e essa
   * lista fica errada em silencio -- ninguem recebe erro, e a trilha so parece
   * estranha. Ver a decisao 7 da spec 009.
   *
   * A ordem e **renormalizada a cada chamada**, sem posicoes fracionarias nem
   * espacamento de 10 em 10. Sao dezenas de videos por insignia, e a
   * renormalizacao dispensa a manutencao do esquema de espacamento -- que e
   * justamente a parte que apodrece quando ninguem lembra por que os numeros
   * pulam.
   */
  async reorder(orderedIds: string[]): Promise<void> {
    const batch = this.firebase.firestore.batch();
    const updatedAt = Timestamp.now();

    orderedIds.forEach((id, index) => {
      batch.update(this.collection.doc(id), { order: index, updatedAt });
    });

    await batch.commit();
  }
}
