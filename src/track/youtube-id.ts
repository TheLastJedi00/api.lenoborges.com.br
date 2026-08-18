/**
 * Extrai o ID de um video do YouTube a partir do que o admin colar.
 *
 * A URL chega em cinco formas -- `watch?v=`, `youtu.be/`, `/embed/`, com `&t=`,
 * com `?si=` de compartilhamento -- e o admin nao deveria precisar saber disso.
 * A normalizacao acontece **uma vez, na entrada**, e o que se grava e sempre o
 * ID. Sem este dono unico, cada tela que monta um player reimplementa a
 * extracao, e elas divergem. Ver a decisao 6 da spec 009.
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
        ? (url.searchParams.get('v') ?? pathAfter(url.pathname, 'embed'))
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
