import { renderEmail } from './email-template';

const base = {
  subject: 'Vídeo novo na insígnia Lógica',
  body: 'Saiu um vídeo novo.\n\nEle responde a pergunta mais votada da semana.',
  unsubscribeUrl: 'https://api.exemplo.com/emails/descadastro?token=abc',
};

describe('renderEmail', () => {
  it('devolve html e texto gerados da mesma fonte', () => {
    const { html, text } = renderEmail(base);

    expect(html).toContain('Saiu um vídeo novo.');
    expect(text).toContain('Saiu um vídeo novo.');
    expect(text).toContain('Vídeo novo na insígnia Lógica');
  });

  /**
   * **Teste-trava: o assunto não se repete dentro do corpo.**
   *
   * Ele já está no cabeçalho da mensagem, que é onde é lido. Um `<h1>` com o
   * próprio assunto é a abertura de newsletter, e o filtro sabe disso — ver a
   * decisão 11-B.
   */
  it('teste-trava: o assunto nao se repete no corpo do html', () => {
    const { html } = renderEmail(base);

    expect(html).not.toContain('Vídeo novo na insígnia Lógica');
    expect(html).not.toContain('<h1');
  });

  /**
   * **Teste-trava: o HTML não tem estilo, e não tem moldura.**
   *
   * Este é o teste que a spec 014 comprou caro. O template diagramado — tabela
   * de layout, fundo cinza, cartão branco, botão sólido — já voltou uma vez, e
   * na medição de 2026-08-26, com o rastreamento do Resend já desligado, foi
   * ele que decidiu a aba: diagramado caiu em Promoções, limpo caiu na
   * Principal.
   *
   * Um `style` inline, um `<table>` ou uma `<img>` aqui não é questão de
   * gosto; é a mudança que devolve o e-mail à aba de Promoções sem que ninguém
   * perceba, porque nada quebra e o envio continua funcionando.
   */
  it('teste-trava: o html nao tem style, table nem imagem', () => {
    const { html } = renderEmail({
      ...base,
      ctaLabel: 'Ver na trilha',
      ctaUrl: 'https://exemplo.com/dashboard/trilha/logica',
    });

    expect(html).not.toMatch(/style=/);
    expect(html).not.toMatch(/<table/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/background|border-radius|padding/i);
  });

  /**
   * **Conta parágrafos, e não CSS.**
   *
   * Este teste casava a string `<p style="margin:0 0 16px` e quebrou no dia em
   * que o HTML foi simplificado para escapar da aba de Promoções — a mudança
   * trocou `margin:0` por `margin: 0`, com espaço, e nada mais. Um teste que
   * casa estilo inline não pega defeito nenhum e quebra em toda mudança de
   * estilo, que é o pior dos dois mundos: ele custa manutenção e não protege.
   *
   * O que importa aqui é o comportamento — cada bloco separado por linha em
   * branco vira um parágrafo — e é isso que ele passa a afirmar.
   *
   * Ele também não pode contar um número fixo de `<p>`: o template tem
   * parágrafos próprios (o rótulo do topo, o rodapé) que não vêm do corpo, e
   * fixar o total faz o teste quebrar de novo em toda mudança de moldura. Por
   * isso ele mede a **diferença**: um bloco a mais no corpo é um parágrafo a
   * mais no HTML, valha o que valer o resto.
   */
  it('cada bloco separado por linha em branco vira um paragrafo no html', () => {
    const contaParagrafos = (html: string) =>
      (html.match(/<p[\s>]/g) ?? []).length;

    const doisBlocos = renderEmail(base);
    const tresBlocos = renderEmail({
      ...base,
      body: `${base.body}\n\nE ainda tem um terceiro bloco.`,
    });

    expect(
      contaParagrafos(tresBlocos.html) - contaParagrafos(doisBlocos.html),
    ).toBe(1);
    expect(doisBlocos.html).toContain('Saiu um vídeo novo.</p>');
    expect(doisBlocos.html).toContain(
      'Ele responde a pergunta mais votada da semana.</p>',
    );
  });

  it('teste-trava: o corpo e escapado, e marcacao digitada sai como texto', () => {
    // Sem isto, "o admin escreve texto e nunca HTML" seria só uma convenção que
    // o primeiro <script> desmentiria.
    const { html, text } = renderEmail({
      ...base,
      body: 'Cuidado com <b>isto</b> e com <script>alert(1)</script>',
    });

    expect(html).not.toContain('<b>isto</b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;isto&lt;/b&gt;');
    expect(text).toContain('<b>isto</b>');
  });

  it('escapa o rotulo do botao', () => {
    const { html } = renderEmail({
      ...base,
      ctaLabel: '<i>Ver</i>',
      ctaUrl: 'https://exemplo.com/trilha',
    });

    expect(html).not.toContain('<i>Ver</i>');
    expect(html).toContain('&lt;i&gt;Ver&lt;/i&gt;');
  });

  it('o botao e opcional, e sai nas duas partes quando existe', () => {
    const sem = renderEmail(base);
    expect(sem.html).not.toContain('<a href="https://exemplo.com');

    const com = renderEmail({
      ...base,
      ctaLabel: 'Ver na trilha',
      ctaUrl: 'https://exemplo.com/dashboard/trilha/logica',
    });

    expect(com.html).toContain('https://exemplo.com/dashboard/trilha/logica');
    expect(com.text).toContain(
      'Ver na trilha: https://exemplo.com/dashboard/trilha/logica',
    );
  });

  it('o link de descadastro esta nas duas partes, sempre', () => {
    const { html, text } = renderEmail(base);

    expect(html).toContain(base.unsubscribeUrl);
    expect(text).toContain(base.unsubscribeUrl);
  });

  /**
   * A garantia da decisão 8 posta onde ela não pode ser esquecida: não existe
   * caminho neste código que gere e-mail sem rodapé de descadastro. Devolver um
   * e-mail sem ele seria a falha invisível — o envio funcionaria, e o problema
   * apareceria como denúncia de spam semanas depois.
   */
  it('teste-trava: sem a URL de descadastro, lanca em vez de gerar o e-mail', () => {
    expect(() => renderEmail({ ...base, unsubscribeUrl: '' })).toThrow(
      /descadastro/,
    );
  });
});
