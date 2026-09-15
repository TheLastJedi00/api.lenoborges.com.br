/**
 * Limites e caminhos do Storage (spec 027, decisao 4).
 *
 * **Os caminhos moram aqui, e nao no service, porque cada um e lido em tres
 * lugares**: na escrita, na remocao e na conferencia da URL que volta no
 * `complete`. E o mesmo desenho do `trainingCompletionDocId` -- a regra tem um
 * dono so, e tres literais iguais em arquivos diferentes divergem no dia em que
 * alguem muda um.
 */

/**
 * Teto do arquivo que entra, em bytes.
 *
 * O avatar chega comprimido em 200x200 pelo front e nao se aproxima disso; o
 * limite existe pela foto de resultado da Arena, que e uma foto de celular
 * inteira, e pelo cliente que **nao** e o nosso -- a rota e HTTP autenticado, e
 * quem tiver um token pode mandar o que quiser sem passar pela nossa tela.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * O que o produto aceita como imagem.
 *
 * Tres formatos, e nao "tudo que comeca com image/": SVG e imagem e tambem e um
 * documento que executa script, e ele sairia deste bucket por uma URL publica do
 * nosso dominio de storage. GIF fica fora por ser animacao num lugar onde o
 * produto promete uma foto.
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** A extensao gravada no caminho, derivada do tipo **detectado**. */
export const EXTENSION_BY_TYPE: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Onde mora o avatar de um membro.
 *
 * **Sem sufixo aleatorio e sem extensao, de proposito**: a foto nova sobrescreve
 * a velha. Um nome por upload deixaria no bucket toda foto que a pessoa ja
 * trocou, cobrada para sempre e sem nada apontando para ela -- e a limpeza
 * exigiria varrer o bucket comparando com o Firestore, que e exatamente o tipo
 * de tarefa que nunca e escrita.
 *
 * O preco e o cache: a URL nao muda entre trocas, e o navegador serviria a
 * antiga. Quem paga esse preco e o `?v=` que o `StorageService.upload` poe na
 * URL de volta.
 */
export function avatarPath(uid: string): string {
  return `avatars/${uid}`;
}

/**
 * Onde mora a foto de resultado de um desafio.
 *
 * O `uid` vem **antes** do `trainingId`, e essa ordem e o que faz a conferencia
 * do `complete` ser possivel: a URL de outro membro nao cabe no prefixo deste
 * membro, e `isOwnUrl` reprova sem precisar consultar nada.
 */
export function trainingResultPath(uid: string, trainingId: string): string {
  return `trainings/${uid}/${trainingId}`;
}
