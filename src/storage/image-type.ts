import { AllowedImageType } from './storage.constants';

/**
 * Descobre o tipo da imagem pelos **bytes iniciais** do arquivo (spec 027,
 * decisao 4).
 *
 * **Nunca pelo `mimetype` do multipart, nunca pela extensao do nome.** Os dois
 * sao campos que quem envia escreve: um `.png` com bytes de executavel passa por
 * qualquer checagem que olhe o que o arquivo diz de si mesmo. E o mesmo erro que
 * o `isUrlOf` de `src/common/social-url.ts` documenta do outro lado -- confiar na
 * string em vez de conferir a estrutura.
 *
 * O que isto **nao** e: nao decodifica a imagem e nao garante que ela abre. Um
 * JPEG truncado passa aqui e falha no navegador de quem for ver. A pergunta que
 * esta funcao responde e "isto e do formato que eu aceito", que e a que decide se
 * o arquivo entra no bucket.
 */
export function detectImageType(buffer: Buffer): AllowedImageType | null {
  // Tres, que e a menor assinatura que esta funcao conhece -- e nao doze, que e a
  // maior. Cada formato se limita sozinho: `buffer[4]` de um buffer curto e
  // `undefined` e reprova a comparacao, e o `toString` de uma faixa que nao existe
  // devolve string curta, que nao e igual a 'WEBP'. Exigir doze aqui confundiria
  // "curto demais para ser um arquivo de verdade" com "nao e um formato que eu
  // aceito", e um cabecalho legitimo de oito bytes cairia como desconhecido.
  if (buffer.length < 3) {
    return null;
  }

  // FF D8 FF: SOI seguido do primeiro marcador. Dois bytes so (FF D8) tambem
  // apareceriam no meio de dados binarios quaisquer.
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // 89 P N G \r \n 1A \n -- os oito bytes, e nao os quatro primeiros: a sequencia
  // inteira existe no formato justamente para sobreviver a transferencia que
  // converte fim de linha.
  if (
    buffer[0] === 0x89 &&
    buffer.toString('ascii', 1, 4) === 'PNG' &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // RIFF....WEBP. **Os dois pedacos, porque WAV tambem e RIFF**: comparar so os
  // quatro primeiros bytes deixaria um audio entrar como imagem.
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
