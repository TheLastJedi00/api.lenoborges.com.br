/**
 * O template dos e-mails do produto (spec 014, decisões 11 e 11-B).
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
 *
 * **O HTML diagramado está aqui pela terceira vez, e desta vez os dois outros
 * suspeitos foram eliminados por conferência, e não por hipótese.** A caça à
 * aba **Promoções** do Gmail já acusou este arquivo duas vezes — `58c5bdb` e
 * `f3be226` —, e nas duas o preço foi um e-mail feio. Em 2026-08-26 as outras
 * duas frentes foram conferidas de ponta a ponta:
 *
 * - **Provedor.** O domínio `lenoborges.com.br` está `verified` no Resend, com
 *   `open_tracking: false` e `click_tracking: false`. O pixel 1×1 e a reescrita
 *   de links — a causa medida no `9154943` — continuam desligados.
 * - **DNS e plataforma.** DKIM (`resend._domainkey`) e o SPF do return-path
 *   (`send.lenoborges.com.br`, TXT + MX) verificados; DMARC publicado; o
 *   envelope alinha em modo relaxado. O DNS vive no registro.br, e a Vercel não
 *   gerencia a zona deste domínio — não há registro pendente do lado dela.
 *   Sobra só um `CNAME liga` de *Tracking* em `failed` no painel do Resend,
 *   resíduo inerte de quando o subdomínio de rastreamento era outro (hoje é
 *   `mail`, verificado).
 *
 * Com o provedor e a configuração limpos, o envio de teste foi refeito e a
 * marcação **não** decidiu a aba. Então o HTML volta.
 *
 * **A regra que sobra, e que custou três voltas:** este arquivo é o suspeito
 * mais fácil de acusar e o mais caro de condenar, porque a "correção" nunca
 * quebra nada — ela só deixa o e-mail feio, e o sintoma some ou não por conta
 * de outra coisa. Antes de tirar estilo daqui outra vez, confira o painel do
 * provedor e o DNS **primeiro**, e traga a medição junto.
 *
 * Ver Fases 08 a 11 em `specs/014 - Disparo de E-mails/tasks.md`.
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
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#101828;">${escapeHtml(
          bloco,
        ).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');

  const htmlCta = temCta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(
        content.ctaUrl!,
      )}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#101828;color:#ffffff;font-weight:700;text-decoration:none;">${escapeHtml(
        content.ctaLabel!,
      )}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="margin:0 0 20px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#6941c6;font-weight:700;">Liga Dev</p>
          <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#101828;">${escapeHtml(
            content.subject,
          )}</h1>
          ${htmlParagrafos}${htmlCta}
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 28px;border-top:1px solid #eaecf0;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#667085;">
            Você recebe este e-mail porque é membro da Liga Dev.
            <a href="${escapeHtml(
              content.unsubscribeUrl,
            )}" style="color:#6941c6;">Cancelar inscrição</a>.
          </p>
        </td>
      </tr>
    </table>
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
