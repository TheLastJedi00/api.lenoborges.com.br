/**
 * O template dos e-mails do produto (spec 014, decisão 11).
 *
 * **O admin escreve texto, e nunca HTML.** O corpo é texto simples com quebras
 * de linha, mais um botão opcional; o cabeçalho, a tipografia e o rodapé são do
 * código, e são os mesmos nos dois disparos. Aceitar HTML do admin significa
 * aceitar que um erro de marcação quebre a renderização em cinco clientes de
 * e-mail diferentes, e significa sanitizar entrada que vira documento enviado
 * para fora.
 *
 * **As duas partes saem da mesma fonte.** Cliente que não renderiza HTML é
 * minoria, mas e-mail sem alternativa em texto é sinal de spam para os filtros.
 */

export interface EmailContent {
  subject: string;
  /** Texto puro, com quebras de linha. Cada linha em branco separa parágrafos. */
  body: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  /**
   * Para onde o "cancelar inscrição" do rodapé aponta.
   *
   * **Obrigatória, e a função lança sem ela** (Task 05 da Fase 01). É a garantia
   * da decisão 8 posta onde ela não pode ser esquecida: não existe caminho neste
   * código que gere e-mail sem o link de descadastro.
   */
  unsubscribeUrl: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Escapa o que o admin digitou.
 *
 * `<b>` digitado no corpo sai como texto, e nunca como marcação — que é a única
 * forma de a decisão 11 valer de verdade. Sem isto, "texto simples" seria só uma
 * convenção que o primeiro `<script>` desmentiria.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Cada bloco separado por linha em branco vira um parágrafo. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function renderEmail(content: EmailContent): RenderedEmail {
  if (!content.unsubscribeUrl) {
    throw new Error(
      'renderEmail exige unsubscribeUrl: nao existe e-mail deste produto sem link de descadastro.',
    );
  }

  const blocos = paragraphs(content.body);
  const temCta = Boolean(content.ctaLabel && content.ctaUrl);

  const htmlParagrafos = blocos
    .map(
      (bloco) =>
        `<p style="margin: 0 0 16px;">${escapeHtml(bloco).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');

  const htmlCta = temCta
    ? `<p style="margin: 24px 0 0;"><a href="${escapeHtml(content.ctaUrl!)}" style="color: #6941c6; font-weight: 700; text-decoration: underline;">${escapeHtml(content.ctaLabel!)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #101828; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 24px;">${escapeHtml(content.subject)}</h1>
    ${htmlParagrafos}${htmlCta}
    <hr style="border: none; border-top: 1px solid #eaecf0; margin: 32px 0 24px;">
    <p style="font-size: 12px; color: #667085; margin: 0;">
      Você recebe este e-mail porque é membro da Liga Dev.<br>
      <a href="${escapeHtml(content.unsubscribeUrl)}" style="color: #6941c6;">Cancelar inscrição</a>.
    </p>
  </body>
</html>`;

  const textCta = temCta ? `\n\n${content.ctaLabel}: ${content.ctaUrl}` : '';

  const text = `${content.subject}

${blocos.join('\n\n')}${textCta}

--
Você recebe este e-mail porque é membro da Liga Dev.
Cancelar inscrição: ${content.unsubscribeUrl}`;

  return { html, text };
}
