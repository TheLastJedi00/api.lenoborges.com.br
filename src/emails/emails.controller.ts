import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FirebaseService } from '../auth/firebase.service';
import { ProfileRepository } from '../profile/profile.repository';
import type { EmailOptOutReason } from '../profile/entities/profile.entity';
import { verifyUnsubscribeToken } from './unsubscribe-token';
import { verifyWebhookSignature } from './webhook-signature';
import type { WebhookHeaders } from './webhook-signature';

/**
 * O que sai do produto e volta de fora (spec 014).
 *
 * **Os dois endpoints daqui são públicos**, e cada um tem o próprio jeito de
 * provar quem chamou: o descadastro por token assinado, o webhook por assinatura
 * do provedor. Nenhum deles exige sessão, e a ausência é decisão em ambos.
 */
@ApiTags('emails')
@Controller('emails')
export class EmailsController {
  private readonly logger = new Logger(EmailsController.name);
  private readonly unsubscribeSecret: string;
  /**
   * Vazio fora de produção, e aí o webhook recusa tudo.
   *
   * É o lado seguro do erro: sem segredo, aceitar seria deixar qualquer um
   * descadastrar quem quiser. Em produção o boot exige a variável.
   */
  private readonly webhookSecret: string;

  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly firebase: FirebaseService,
    private readonly configService: ConfigService,
  ) {
    this.unsubscribeSecret = this.configService.getOrThrow<string>(
      'EMAIL_UNSUBSCRIBE_SECRET',
    );
    this.webhookSecret =
      this.configService.get<string>('RESEND_WEBHOOK_SECRET') ?? '';
  }

  /**
   * Descadastro em um clique, sem login (decisão 9).
   *
   * Aceita `POST` **cru, sem confirmação nenhuma**, porque é isso que o
   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` do Gmail e do Yahoo
   * dispara. Não é refinamento: é requisito de remetente em massa desde 2024, e
   * sem ele a entrega degrada por política, independentemente do conteúdo.
   *
   * **Responde `204` sempre**, inclusive com token inválido e com `uid` sem
   * perfil. Um endpoint público que diferencia token válido de inválido é um
   * oráculo de `uid`, e o descadastro não ganha nada com a distinção.
   *
   * Fica sob o `ThrottlerGuard` global com limite próprio: endpoint de escrita
   * público sem limite é o alvo mais barato que a API tem.
   */
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('descadastro')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sair da lista de e-mails',
    description:
      'PÚBLICO e IDEMPOTENTE. Aceita POST cru, sem confirmação, para atender o ' +
      'one-click do Gmail e do Yahoo. Responde 204 sempre — inclusive com token ' +
      'inválido —, porque diferenciar seria um oráculo de uid.',
  })
  @ApiResponse({ status: 204, description: 'Pedido registrado, ou ignorado.' })
  async unsubscribe(@Query('token') token?: string): Promise<void> {
    const uid = token
      ? verifyUnsubscribeToken(token, this.unsubscribeSecret)
      : null;

    if (!uid) {
      // Sem log de token, que é dado de terceiro; o que importa saber é que
      // alguém chegou aqui com um token que não confere.
      this.logger.warn('Descadastro com token invalido ou ausente.');
      return;
    }

    const { found } = await this.profileRepository.setEmailOptOut(
      uid,
      true,
      'membro',
    );

    if (!found) {
      this.logger.warn(`Descadastro para uid sem perfil: ${uid}`);
    }
  }

  /**
   * Bounce permanente e reclamação de spam viram descadastro (decisão 10).
   *
   * Sem isto, um endereço morto é retentado em toda campanha, para sempre, e a
   * taxa de bounce do remetente sobe sozinha até o provedor limitar a conta. É o
   * tipo de manutenção que ninguém faz à mão porque ninguém percebe que precisa —
   * e quando percebe, já é o problema.
   *
   * **Bounce temporário não desliga nada.** Caixa cheia volta a funcionar;
   * tratar `soft bounce` como descadastro remove membro válido da lista por
   * causa de uma semana de férias.
   */
  @Post('webhook/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async resendWebhook(@Req() request: RawBodyRequest<Request>): Promise<void> {
    // **O corpo cru, e nunca o reserializado**: assinatura calculada sobre JSON
    // já parseado e remontado não confere, e o sintoma é "o webhook nunca
    // valida" sem nenhuma pista do motivo.
    const rawBody = request.rawBody?.toString('utf8') ?? '';

    const ok = verifyWebhookSignature(
      rawBody,
      request.headers as WebhookHeaders,
      this.webhookSecret,
    );

    if (!ok) {
      // 401, e **nada é escrito**. É o oposto do descadastro logo acima: lá o
      // 204 indistinto protege a privacidade de quem clicou; aqui a assinatura
      // é a única prova de quem chamou, e aceitar sem ela deixaria qualquer um
      // que descubra a URL descadastrar quem quiser.
      throw new UnauthorizedException();
    }

    const evento = parseEvent(rawBody);
    if (!evento) {
      return;
    }

    const motivo = optOutReasonFor(evento);
    if (!motivo) {
      // Bounce temporário e todo evento que não é bounce nem reclamação passam
      // batido: entrega, abertura e clique não mudam nada aqui.
      return;
    }

    // O webhook chega com o **endereço**, e o descadastro é por `uid`.
    let uid: string;
    try {
      const user = await this.firebase.auth.getUserByEmail(evento.email);
      uid = user.uid;
    } catch {
      // Endereço que não existe mais é ignorado em silêncio: pode ser de alguém
      // que já excluiu a conta entre o envio e o bounce.
      this.logger.warn(
        `Webhook ${evento.type} para endereco sem conta. Nada a fazer.`,
      );
      return;
    }

    await this.profileRepository.setEmailOptOut(uid, true, motivo);
    this.logger.log(`Descadastro automatico por ${motivo}: ${uid}`);
  }
}

/** O que interessa do corpo do webhook. O resto é ignorado. */
interface ResendEvent {
  type: string;
  email: string;
  bounceType?: string;
}

function parseEvent(rawBody: string): ResendEvent | null {
  try {
    const payload = JSON.parse(rawBody) as {
      type?: unknown;
      data?: {
        to?: unknown;
        email?: unknown;
        bounce?: { type?: unknown };
      };
    };

    const type = typeof payload.type === 'string' ? payload.type : null;
    if (!type) {
      return null;
    }

    // O destinatário vem em `data.to` (lista) ou `data.email`, conforme o
    // evento. Um só destinatário por mensagem, porque é assim que a campanha
    // envia.
    const to = payload.data?.to;
    const email = Array.isArray(to)
      ? typeof to[0] === 'string'
        ? to[0]
        : null
      : typeof payload.data?.email === 'string'
        ? payload.data.email
        : null;

    if (!email) {
      return null;
    }

    const bounceType = payload.data?.bounce?.type;

    return {
      type,
      email,
      bounceType: typeof bounceType === 'string' ? bounceType : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Qual motivo de descadastro este evento produz, ou `null` para nenhum.
 *
 * **Bounce temporário devolve `null` de propósito**: caixa cheia volta a
 * funcionar, e tratar `soft bounce` como descadastro remove membro válido da
 * lista por causa de uma semana de férias.
 */
function optOutReasonFor(evento: ResendEvent): EmailOptOutReason | null {
  if (evento.type === 'email.complained') {
    return 'reclamacao';
  }

  if (evento.type === 'email.bounced') {
    const tipo = (evento.bounceType ?? '').toLowerCase();
    // Ausência de tipo é tratada como permanente: o provedor manda
    // `email.bounced` para hard bounce, e o campo detalha quando existe.
    return tipo === 'transient' || tipo === 'soft' ? null : 'bounce';
  }

  return null;
}
