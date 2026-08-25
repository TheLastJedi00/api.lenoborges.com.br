import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './webhook-signature';
import type { WebhookHeaders } from './webhook-signature';

const SECRET = `whsec_${Buffer.from('segredo-do-webhook').toString('base64')}`;
const AGORA = 1_800_000_000;

function assinar(
  rawBody: string,
  id = 'msg_1',
  timestamp = String(AGORA),
): WebhookHeaders {
  const bytes = Buffer.from(SECRET.slice(6), 'base64');
  const assinatura = createHmac('sha256', bytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${assinatura}`,
  };
}

const corpo = JSON.stringify({ type: 'email.bounced' });

describe('verifyWebhookSignature', () => {
  it('aceita a assinatura correta', () => {
    expect(verifyWebhookSignature(corpo, assinar(corpo), SECRET, AGORA)).toBe(
      true,
    );
  });

  /**
   * Sem isto, qualquer um que descubra a URL descadastra quem quiser: o webhook
   * é público por natureza, e a assinatura é a única prova de quem chamou.
   */
  it('teste-trava: assinatura invalida nao passa', () => {
    const headers = assinar(corpo);
    headers['svix-signature'] = 'v1,YXNzaW5hdHVyYS1lcnJhZGE=';

    expect(verifyWebhookSignature(corpo, headers, SECRET, AGORA)).toBe(false);
  });

  it('teste-trava: corpo adulterado depois de assinado nao passa', () => {
    const headers = assinar(corpo);

    expect(
      verifyWebhookSignature(
        JSON.stringify({ type: 'email.complained' }),
        headers,
        SECRET,
        AGORA,
      ),
    ).toBe(false);
  });

  it('assinatura de outro segredo nao passa', () => {
    const outro = `whsec_${Buffer.from('outro-segredo').toString('base64')}`;

    expect(verifyWebhookSignature(corpo, assinar(corpo), outro, AGORA)).toBe(
      false,
    );
  });

  it('cabecalho faltando nao passa', () => {
    expect(verifyWebhookSignature(corpo, {}, SECRET, AGORA)).toBe(false);

    const semId = assinar(corpo);
    delete semId['svix-id'];
    expect(verifyWebhookSignature(corpo, semId, SECRET, AGORA)).toBe(false);
  });

  it('segredo ausente nao passa: sem chave, o webhook recusa tudo', () => {
    expect(verifyWebhookSignature(corpo, assinar(corpo), '', AGORA)).toBe(
      false,
    );
  });

  it('mensagem velha demais nao passa, para nao aceitar replay', () => {
    const headers = assinar(corpo, 'msg_1', String(AGORA - 3600));

    expect(verifyWebhookSignature(corpo, headers, SECRET, AGORA)).toBe(false);
  });

  it('aceita uma das assinaturas quando o provedor esta rotacionando o segredo', () => {
    const headers = assinar(corpo);
    headers['svix-signature'] =
      `v1,YXNzaW5hdHVyYS12ZWxoYQ== ${headers['svix-signature']}`;

    expect(verifyWebhookSignature(corpo, headers, SECRET, AGORA)).toBe(true);
  });

  it('versao desconhecida nao passa', () => {
    const headers = assinar(corpo);
    headers['svix-signature'] = headers['svix-signature']!.replace(
      'v1,',
      'v9,',
    );

    expect(verifyWebhookSignature(corpo, headers, SECRET, AGORA)).toBe(false);
  });
});
