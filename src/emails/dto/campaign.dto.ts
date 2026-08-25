import { ApiProperty } from '@nestjs/swagger';
import type {
  CampaignKind,
  CampaignStatus,
} from '../entities/email-campaign.entity';

/** O resultado de um disparo. É o que `POST /admin/emails` responde. */
export class CampaignResultDto {
  @ApiProperty({ example: '8f2c1a3b' })
  id: string;

  @ApiProperty({
    example: 'concluida',
    enum: ['enviando', 'concluida', 'interrompida'],
    description:
      '`interrompida` significa que um lote falhou e o cursor ficou no fim do ' +
      'último lote confirmado — "Retomar" continua dali, e não do começo',
  })
  status: CampaignStatus;

  @ApiProperty({ example: 42 })
  audienceCount: number;

  @ApiProperty({ example: 42 })
  sentCount: number;

  @ApiProperty({ example: 0 })
  failedCount: number;
}

/**
 * Uma linha do histórico.
 *
 * > **Não devolve `body`, e isso é decisão.** A listagem existe para responder
 * > "o que saiu e para quantos"; o corpo do e-mail é peso morto nela — até
 * > cinco mil caracteres por linha, vinte linhas por resposta. Alguém vai querer
 * > "completar" o DTO na primeira vez que precisar reler um envio; a resposta é
 * > uma rota de detalhe, não engordar a lista.
 */
export class CampaignSummaryDto extends CampaignResultDto {
  @ApiProperty({
    example: 'video',
    enum: ['video', 'manual'],
    description:
      '`video` é o gatilho automático; `manual` é o admin escrevendo',
  })
  kind: CampaignKind;

  @ApiProperty({ example: 'Vídeo novo na insígnia Lógica' })
  subject: string;

  @ApiProperty({ example: '2026-08-25T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-08-25T12:00:05.000Z', nullable: true })
  finishedAt: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'O que o provedor respondeu quando o lote falhou',
  })
  error: string | null;
}
