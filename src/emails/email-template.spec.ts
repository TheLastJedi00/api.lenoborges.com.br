import { renderEmail } from './email-template';

const base = {
  subject: 'Vídeo novo na insígnia Lógica',
  body: 'Saiu um vídeo novo.\n\nEle responde a pergunta mais votada da semana.',
  unsubscribeUrl: 'https://api.exemplo.com/emails/descadastro?token=abc',
};

describe('renderEmail', () => {
  it('devolve html e texto gerados da mesma fonte', () => {
    const { html, text } = renderEmail(base);

    expect(html).toContain('Vídeo novo na insígnia Lógica');
    expect(text).toContain('Vídeo novo na insígnia Lógica');
    expect(html).toContain('Saiu um vídeo novo.');
    expect(text).toContain('Saiu um vídeo novo.');
  });

  it('cada bloco separado por linha em branco vira um paragrafo no html', () => {
    const { html } = renderEmail(base);

    expect((html.match(/<p style="margin:0 0 16px/g) ?? []).length).toBe(2);
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

  it('escapa tambem o assunto e o rotulo do botao', () => {
    const { html } = renderEmail({
      ...base,
      subject: 'Promoção <b>imperdível</b>',
      ctaLabel: '<i>Ver</i>',
      ctaUrl: 'https://exemplo.com/trilha',
    });

    expect(html).not.toContain('<b>imperdível</b>');
    expect(html).not.toContain('<i>Ver</i>');
  });

  it('o botao e opcional, e sai nas duas partes quando existe', () => {
    const sem = renderEmail(base);
    expect(sem.html).not.toContain('border-radius:8px;background:#101828');

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
