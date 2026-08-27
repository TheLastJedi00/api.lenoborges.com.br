/**
 * Extrai o ID de um video do YouTube a partir do que o admin colar.
 *
 * A URL chega em seis formas -- `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`,
 * com `&t=`, com `?si=` de compartilhamento -- e o admin nao deveria precisar
 * saber disso. A normalizacao acontece **uma vez, na entrada**, e o que se grava
 * e sempre o ID. Sem este dono unico, cada tela que monta um player reimplementa
 * a extracao, e elas divergem. Ver a decisao 6 da spec 009.
 *
 * **Short nao precisa de nada alem desta funcao** (spec 017). O ID dele e o
 * mesmo ID de 11 caracteres, o documento continua sendo `{badgeId}__{youtubeId}`
 * e o player de embed do YouTube serve Short sem tratamento especial -- procurar
 * um player proprio para Shorts e procurar o que nao existe. O que muda na tela
 * e so a proporcao do iframe, e ela sai do `orientation` derivado no DTO.
 *
 * Esta lista e a lista inteira que o produto aceita: forma que nao esta aqui e
 * 400 na cara do admin, e a de Shorts esteve de fora ate a spec 017 -- a aba de
 * respostas parecia pronta e nao aceitava o unico link que o YouTube copia num
 * celular.
 */

/** ID do YouTube: 11 caracteres de um alfabeto base64url. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYoutubeId(raw: string): {
  found: boolean;
  id: string | null;
} {
  const value = raw.trim();

  if (!value) {
    return { found: false, id: null };
  }

  // O admin pode colar so o ID. Recusar isso seria pedantismo.
  if (YOUTUBE_ID.test(value)) {
    return { found: true, id: value };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { found: false, id: null };
  }

  const host = url.hostname.replace(/^www\./, '');
  const candidate =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com' || host === 'm.youtube.com'
        ? (url.searchParams.get('v') ??
          pathAfter(url.pathname, 'embed') ??
          // Shorts e a sexta forma, e entra pelo mesmo `pathAfter` das outras:
          // um segundo caminho paralelo aqui e o comeco da divergencia que o
          // dono unico existe para evitar.
          pathAfter(url.pathname, 'shorts'))
        : null;

  if (!candidate || !YOUTUBE_ID.test(candidate)) {
    return { found: false, id: null };
  }

  return { found: true, id: candidate };
}

/** Devolve o segmento seguinte a `marker` no caminho, ou null. */
function pathAfter(pathname: string, marker: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const index = parts.indexOf(marker);

  return index >= 0 ? (parts[index + 1] ?? null) : null;
}
