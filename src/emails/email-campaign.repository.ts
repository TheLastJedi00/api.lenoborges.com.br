import { Injectable } from '@nestjs/common';
import { CollectionReference, Timestamp } from 'firebase-admin/firestore';
import { FirebaseService } from '../auth/firebase.service';
import {
  CampaignStatus,
  EmailCampaign,
  emailCampaignConverter,
} from './entities/email-campaign.entity';

export const EMAIL_CAMPAIGN_COLLECTION = 'email_campaigns';

/** Quantas campanhas o histórico da tela mostra. */
export const RECENT_CAMPAIGNS = 20;

export type CreateCampaignData = Pick<
  EmailCampaign,
  | 'kind'
  | 'subject'
  | 'body'
  | 'ctaLabel'
  | 'ctaUrl'
  | 'filters'
  | 'audienceCount'
  | 'createdBy'
> & {
  /** Só a campanha de vídeo traz o próprio: o caminho é a unicidade dela. */
  id?: string;
};

@Injectable()
export class EmailCampaignRepository {
  constructor(private readonly firebase: FirebaseService) {}

  private get collection(): CollectionReference<EmailCampaign> {
    return this.firebase.firestore
      .collection(EMAIL_CAMPAIGN_COLLECTION)
      .withConverter(emailCampaignConverter);
  }

  /**
   * Cria a campanha já `enviando`.
   *
   * **`create()`, nunca `set()`.** Para a campanha de vídeo, cujo id é
   * `video__{badgeId}__{youtubeId}`, é o `ALREADY_EXISTS` daqui que impede um
   * retry de rede de anunciar o mesmo vídeo duas vezes para a base inteira. Quem
   * traduz a corrida é o service.
   */
  async create(data: CreateCampaignData): Promise<{ entry: EmailCampaign }> {
    const ref = data.id ? this.collection.doc(data.id) : this.collection.doc();

    const entry: EmailCampaign = {
      ...data,
      id: ref.id,
      status: 'enviando',
      sentCount: 0,
      failedCount: 0,
      cursorUid: null,
      createdAt: new Date(),
      finishedAt: null,
      error: null,
    };

    await ref.create(entry);

    return { entry };
  }

  async findById(
    id: string,
  ): Promise<{ found: boolean; entry: EmailCampaign | null }> {
    const snapshot = await this.collection.doc(id).get();

    if (!snapshot.exists) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.data()! };
  }

  /**
   * Grava o progresso depois de cada lote (decisão 4).
   *
   * **É a escrita que torna a falha recuperável**, e ela é por lote, não por
   * destinatário: um registro por pessoa seria fan-out de escrita, que a spec
   * 012 recusou pelas mesmas razões e com mais força aqui.
   */
  async updateProgress(
    id: string,
    cursorUid: string,
    sentCount: number,
    failedCount: number,
  ): Promise<void> {
    await this.collection.doc(id).update({
      cursorUid,
      sentCount,
      failedCount,
    });
  }

  async finish(
    id: string,
    status: CampaignStatus,
    error: string | null,
  ): Promise<void> {
    await this.collection.doc(id).update({
      status,
      error,
      finishedAt: Timestamp.now(),
    });
  }

  /**
   * As mais recentes, para o histórico da tela.
   *
   * **`orderBy` por um campo só — nenhum índice composto novo** (decisão 13). O
   * índice de campo único do Firestore já atende, e é por isso que o corte é
   * `limit`, e não um `where` de período: cada `where` combinado com ordenação
   * viraria uma linha nova na tabela de índices do README.
   */
  async listRecent(limit = RECENT_CAMPAIGNS): Promise<EmailCampaign[]> {
    const snapshot = await this.collection
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((document) => document.data());
  }

  /**
   * O trinco de um disparo por vez (decisão 15).
   *
   * **Filtro por um campo só, sem ordenação — também sem índice novo.** Dois
   * disparos concorrentes estouram o limite de requisições do provedor,
   * embaralham os dois cursores e, no pior caso, mandam duas campanhas para a
   * mesma pessoa no mesmo minuto. Esta consulta resolve os três de uma vez.
   */
  async findSending(): Promise<{
    found: boolean;
    entry: EmailCampaign | null;
  }> {
    const snapshot = await this.collection
      .where('status', '==', 'enviando')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { found: false, entry: null };
    }

    return { found: true, entry: snapshot.docs[0].data() };
  }
}
