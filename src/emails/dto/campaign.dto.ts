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
    enum: ['video', 'manual', 'direto'],
    description:
      '`video` é o gatilho automático; `manual` é o admin escrevendo para um ' +
      'recorte; `direto` é o recado para um membro só (spec 015)',
  })
  kind: CampaignKind;

  /**
   * Para quem foi o recado, quando `kind` é `direto`.
   *
   * **Os e-mails diretos aparecem no MESMO histórico das campanhas** (spec 015,
   * decisão 15). Separá-los em duas listas exigiria
   * `where('kind','==',...)` combinado com `orderBy('createdAt')`, que é
   * **índice composto novo em produção** — exatamente o que a decisão 13 da spec
   * 014 recusou.
   *
   * A consequência é conhecida e está no ponto em aberto 3: com muitos e-mails
   * diretos, eles afogam as campanhas nas 20 linhas do histórico. O número que
   * denuncia é a tela deixar de mostrar a última campanha de vídeo — e o
   * conserto, aí, é o filtro por `kind` com o índice decidido e escrito na
   * tabela do README, e não descoberto em produção.
   */
  @ApiProperty({
    nullable: true,
    example: 'Leno Borges',
    description:
      'Nome, ou e-mail quando não houver nome, NO INSTANTE DO ENVIO. Nulo em ' +
      'campanha de vídeo e manual. Denormalizado como o `authorName` do Mural: ' +
      'a conta pode mudar de nome ou deixar de existir, e a linha do histórico ' +
      'precisa continuar legível',
  })
  recipientLabel: string | null;

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
