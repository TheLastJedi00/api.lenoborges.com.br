import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verificação da assinatura do webhook do provedor (spec 014, decisão 10).
 *
 * O Resend assina com o padrão do Svix: três cabeçalhos — `svix-id`,
 * `svix-timestamp` e `svix-signature` — e a assinatura é um HMAC-SHA256 sobre
 * `{id}.{timestamp}.{corpo cru}`, com o segredo em base64 depois do prefixo
 * `whsec_`.
 *
 * **O corpo tem que ser o cru.** Assinatura calculada sobre JSON já parseado e
 * reserializado não confere — a ordem das chaves e os espaços mudam —, e o
 * sintoma é "o webhook nunca valida", sem nenhuma pista do motivo. É por isso
 * que `main.ts` liga o `rawBody`.
 */

export interface WebhookHeaders {
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
}

/** Quanto tempo uma assinatura vale. Protege contra replay de mensagem antiga. */
const TOLERANCIA_SEGUNDOS = 5 * 60;

function secretBytes(secret: string): Buffer {
  const semPrefixo = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  return Buffer.from(semPrefixo, 'base64');
}

export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  agoraEmSegundos = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const assinaturas = headers['svix-signature'];

  if (!id || !timestamp || !assinaturas || !secret) {
    return false;
  }

  const quando = Number(timestamp);
  if (!Number.isFinite(quando)) {
    return false;
  }

  if (Math.abs(agoraEmSegundos - quando) > TOLERANCIA_SEGUNDOS) {
    return false;
  }

  const esperada = createHmac('sha256', secretBytes(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  // O cabeçalho traz uma lista separada por espaço, cada item `v1,<assinatura>`:
  // é assim que o provedor faz rotação de segredo sem derrubar a entrega.
  return assinaturas.split(' ').some((item) => {
    const [versao, valor] = item.split(',');
    if (versao !== 'v1' || !valor) {
      return false;
    }

    const a = Buffer.from(valor);
    const b = Buffer.from(esperada);

    // `timingSafeEqual` exige o mesmo comprimento, e assinatura truncada
    // estouraria em vez de devolver falso.
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
