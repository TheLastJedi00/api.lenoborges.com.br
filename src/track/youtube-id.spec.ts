import { extractYoutubeId } from './youtube-id';

describe('extractYoutubeId', () => {
  // As seis formas que uma URL de YouTube chega quando alguem copia do
  // navegador, do botao de compartilhar ou de um embed.
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watch?v='],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtu.be'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'com timestamp'],
    ['https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123', 'com si de compartilhamento'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'shorts'],
  ])('extrai de %s (%s)', (url) => {
    expect(extractYoutubeId(url)).toEqual({ found: true, id: 'dQw4w9WgXcQ' });
  });

  // O video de resposta do Mural (spec 017) nasce como Short, e a forma abaixo e
  // exatamente o que o botao Compartilhar do app do YouTube copia num celular --
  // que e o link que o admin vai colar. Sem ela, a funcionalidade inteira parece
  // pronta e a primeira pessoa a usa-la leva 400.
  it.each([
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share', 'com feature'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'sem www'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'no dominio movel'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ?t=5', 'com timestamp'],
  ])('extrai de um Short: %s (%s)', (url) => {
    expect(extractYoutubeId(url)).toEqual({ found: true, id: 'dQw4w9WgXcQ' });
  });

  // O admin pode colar so o id, e recusar isso seria pedantismo.
  it('aceita o id cru, ja normalizado', () => {
    expect(extractYoutubeId('dQw4w9WgXcQ')).toEqual({
      found: true,
      id: 'dQw4w9WgXcQ',
    });
  });

  it('tolera espaco em volta', () => {
    expect(extractYoutubeId('  https://youtu.be/dQw4w9WgXcQ  ')).toEqual({
      found: true,
      id: 'dQw4w9WgXcQ',
    });
  });

  // Recusar e o ponto: id invalido gravado vira um player quebrado na trilha,
  // e o defeito so aparece quando um aluno abre a insignia.
  it.each([
    ['https://vimeo.com/123456', 'outro provedor'],
    ['https://www.youtube.com/watch?list=PL123', 'sem o parametro v'],
    ['nao é uma url', 'texto solto'],
    ['', 'vazio'],
    ['https://youtu.be/curto', 'id de tamanho errado'],
    // O caminho sem id nao pode virar string vazia: ela passaria adiante e o
    // documento nasceria como `logica__`, um caminho valido apontando para nada.
    ['https://www.youtube.com/shorts/', 'shorts sem id'],
    ['https://www.youtube.com/shorts/abc', 'shorts com id curto demais'],
  ])('recusa %s (%s)', (url) => {
    expect(extractYoutubeId(url)).toEqual({ found: false, id: null });
  });
});
