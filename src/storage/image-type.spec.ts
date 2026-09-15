import { detectImageType } from './image-type';

/**
 * Cabecalhos reais, curtos. O que importa em cada um sao os bytes de assinatura,
 * e nao um arquivo valido inteiro -- a funcao le o inicio e nao decodifica nada.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function webp(): Buffer {
  const b = Buffer.alloc(16);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(8, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  return b;
}

describe('detectImageType', () => {
  it('reconhece jpeg, png e webp pelos bytes', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(webp())).toBe('image/webp');
  });

  it('recusa o que nao e imagem', () => {
    expect(detectImageType(Buffer.from('nao sou imagem nenhuma'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff]))).toBeNull();
  });

  it('recusa o SVG, que e imagem e tambem e documento com script', () => {
    // Fora da lista de proposito (decisao 4): o bucket e de leitura publica, e um
    // SVG com <script> servido do nosso dominio de storage e XSS hospedado por
    // nos. Nenhuma assinatura binaria o cobre, entao ele cai aqui como texto.
    expect(
      detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
  });

  it('nao acredita no nome nem no Content-Type, so nos bytes', () => {
    // **Este e o teste que a funcao existe para ter** (decisao 4). O `mimetype`
    // do multipart e a extensao do nome sao dois campos que quem envia escreve, e
    // um arquivo que se declara PNG com bytes de outra coisa passa por qualquer
    // checagem que olhe o que ele diz de si mesmo.
    const mentiroso = Buffer.from('MZ\x90\x00 sou um executavel');
    expect(detectImageType(mentiroso)).toBeNull();
  });

  it('reconhece o RIFF que nao e WEBP como nada', () => {
    // WAV tambem e RIFF. Comparar so os quatro primeiros bytes aceitaria audio.
    const wav = Buffer.alloc(16);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    expect(detectImageType(wav)).toBeNull();
  });
});
