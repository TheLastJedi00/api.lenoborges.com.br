import {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  Timestamp,
} from 'firebase-admin/firestore';
import type { TierId } from '../../billing/billing.tiers';

export type CampaignKind = 'video' | 'manual';
export type CampaignStatus = 'enviando' | 'concluida' | 'interrompida';

export interface CampaignFilters {
  /** `null` significa **todos os tiers**, e nunca nenhum. */
  tiers: TierId[] | null;
  gradeMin: number | null;
  gradeMax: number | null;
}

/**
 * Um disparo (spec 014, decisão 17).
 *
 * **Não é log: é o registro.** É o único lugar onde fica escrito o que foi
 * enviado, para quantos e quando. Ao contrário da notificação interna, que a
 * spec 012 deixou sem histórico de propósito, aqui o histórico é obrigatório — e
 * a diferença é que notificação não lida some sem consequência, enquanto e-mail
 * enviado é um fato que existe fora do produto e sobre o qual alguém vai
 * perguntar.
 */
export interface EmailCampaign {
  id: string;
  kind: CampaignKind;
  subject: string;
  /** Texto puro, com quebras de linha. **Nunca HTML** (decisão 11). */
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  filters: CampaignFilters;
  status: CampaignStatus;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  /**
   * O último `uid` do último lote confirmado (decisão 4).
   *
   * **É o que torna a falha recuperável.** Se a função morrer no lote sete, a
   * campanha fica `interrompida` com o cursor no fim do lote seis, e "Retomar"
   * continua dali — não do começo. A ordem por `uid` da audiência é o que faz
   * isso funcionar: é estável, é a mesma que o `listUsers` devolve, e não muda
   * entre uma tentativa e outra.
   */
  cursorUid: string | null;
  createdBy: string;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

interface EmailCampaignDocument extends DocumentData {
  kind: CampaignKind;
  subject: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  filters: CampaignFilters;
  status: CampaignStatus;
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  cursorUid: string | null;
  createdBy: string;
  createdAt: Timestamp;
  finishedAt: Timestamp | null;
  error: string | null;
}

/**
 * O ID da campanha de vídeo. **A regra tem um dono só**, como `questionDocId` e
 * `badgeVideoDocId`.
 *
 * O caminho é a unicidade mais uma vez (spec 007): com `create()`, um `POST`
 * repetido por retry de rede não consegue anunciar o mesmo vídeo duas vezes para
 * a base inteira. É a diferença entre um retry silencioso e um incidente de
 * caixa de entrada.
 */
export function videoCampaignId(badgeId: string, youtubeId: string): string {
  return `video__${badgeId}__${youtubeId}`;
}

export const emailCampaignConverter: FirestoreDataConverter<EmailCampaign> = {
  toFirestore(campaign: EmailCampaign): EmailCampaignDocument {
    return {
      kind: campaign.kind,
      subject: campaign.subject,
      body: campaign.body,
      ctaLabel: campaign.ctaLabel,
      ctaUrl: campaign.ctaUrl,
      filters: campaign.filters,
      status: campaign.status,
      audienceCount: campaign.audienceCount,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      cursorUid: campaign.cursorUid,
      createdBy: campaign.createdBy,
      createdAt: Timestamp.fromDate(campaign.createdAt),
      finishedAt: campaign.finishedAt
        ? Timestamp.fromDate(campaign.finishedAt)
        : null,
      error: campaign.error,
    };
  },

  fromFirestore(snapshot: QueryDocumentSnapshot): EmailCampaign {
    const data = snapshot.data() as EmailCampaignDocument;

    return {
      id: snapshot.id,
      kind: data.kind,
      subject: data.subject,
      body: data.body,
      ctaLabel: data.ctaLabel ?? null,
      ctaUrl: data.ctaUrl ?? null,
      filters: data.filters ?? { tiers: null, gradeMin: null, gradeMax: null },
      status: data.status,
      // Contador ausente viraria NaN na primeira soma da tela do histórico.
      audienceCount: data.audienceCount ?? 0,
      sentCount: data.sentCount ?? 0,
      failedCount: data.failedCount ?? 0,
      cursorUid: data.cursorUid ?? null,
      createdBy: data.createdBy,
      createdAt: data.createdAt.toDate(),
      finishedAt: data.finishedAt ? data.finishedAt.toDate() : null,
      error: data.error ?? null,
    };
  },
};
