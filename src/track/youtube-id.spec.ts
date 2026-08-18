import { extractYoutubeId } from './youtube-id';

describe('extractYoutubeId', () => {
  // As cinco formas que uma URL de YouTube chega quando alguem copia do
  // navegador, do botao de compartilhar ou de um embed.
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watch?v='],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtu.be'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'com timestamp'],
    ['https://youtu.be/dQw4w9WgXcQ?si=AbCdEf123', 'com si de compartilhamento'],
  ])('extrai de %s (%s)', (url) => {
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
  ])('recusa %s (%s)', (url) => {
    expect(extractYoutubeId(url)).toEqual({ found: false, id: null });
  });
});
