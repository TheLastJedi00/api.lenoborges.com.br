/**
 * O template dos e-mails do produto (spec 014, decisões 11 e 11-B).
 *
 * **O admin escreve texto, e nunca HTML.** O corpo é texto simples com quebras
 * de linha, mais um link opcional; a estrutura e o rodapé são do código, e são
 * os mesmos nos dois disparos. Aceitar HTML do admin significa aceitar que um
 * erro de marcação quebre a renderização em cinco clientes de e-mail
 * diferentes, e significa sanitizar entrada que vira documento enviado para
 * fora.
 *
 * **As duas partes saem da mesma fonte.** Cliente que não renderiza HTML é
 * minoria, mas e-mail sem alternativa em texto é sinal de spam para os filtros.
 *
 * **Não há CSS aqui, e isso é a decisão — não é descuido.** O HTML diagramado
 * (tabela de layout, fundo cinza, cartão branco, `<h1>` repetindo o assunto,
 * CTA como botão sólido) já esteve neste arquivo duas vezes, e nas duas o Gmail
 * classificou a mensagem na aba **Promoções**. Em 2026-08-26, com o *Open
 * Tracking* e o *Click Tracking* do Resend **já desligados** — a causa que se
 * acreditou única —, o envio de teste com o template diagramado caiu em
 * Promoções e o envio com o template limpo caiu na **Principal**. Isso é o
 * suspeito medido isolado, e ele é culpado: eram os dois, o rastreamento do
 * provedor **e** a marcação.
 *
 * A regra que fica: **o HTML existe para o texto ser legível, e para mais
 * nada.** Um `<p>` por parágrafo, um `<hr>` antes do rodapé, o link do CTA e o
 * link do descadastro. Sem `style`, sem `<table>`, sem imagem, sem logo, sem
 * botão. O pedido estético mais natural do mundo — "dá um destaque nesse link"
 * — é o que traz a aba de Promoções de volta, e existe teste-trava abaixo
 * dizendo isso em `email-template.spec.ts`.
 *
 * Ver Fase 08 e Fase 10 em `specs/014 - Disparo de E-mails/tasks.md`.
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
    .map((bloco) => `<p>${escapeHtml(bloco).replace(/\n/g, '<br />')}</p>`)
    .join('\n    ');

  /**
   * O CTA é um link dentro de um parágrafo, e nunca um botão. Botão é `padding`,
   * `background` e `border-radius` — a assinatura de campanha que o filtro
   * procura.
   */
  const htmlCta = temCta
    ? `\n    <p><a href="${escapeHtml(content.ctaUrl!)}">${escapeHtml(
        content.ctaLabel!,
      )}</a></p>`
    : '';

  /**
   * O assunto **não** se repete no corpo. Ele já está no cabeçalho da mensagem,
   * que é onde ele é lido; e-mail que uma pessoa escreve para outra não começa
   * com o próprio título em fonte grande — quem faz isso é newsletter.
   */
  const html = `<!doctype html>
<html lang="pt-BR">
  <body>
    ${htmlParagrafos}${htmlCta}
    <hr />
    <p>
      Você recebe este e-mail porque é membro da Liga Dev.<br />
      <a href="${escapeHtml(content.unsubscribeUrl)}">Cancelar inscrição</a>.
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
