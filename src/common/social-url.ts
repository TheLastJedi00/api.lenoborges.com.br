/**
 * Validacao das URLs de rede social do perfil (spec 013, decisao 1).
 *
 * **Nunca regex solta sobre a string inteira.** O jeito obvio -- procurar
 * `linkedin.com` dentro do texto -- aceita `https://evil.com/?u=linkedin.com`,
 * e o campo que deveria apontar para uma rede social vira um campo de link
 * aberto sem ninguem perceber. Aqui a string e parseada como URL e o dominio e
 * comparado por sufixo de rotulo, nao por `includes`.
 */

/** Protocolo aceito. `http://` fica de fora: link de perfil e sempre https. */
const HTTPS = 'https:';

function isUrlOf(value: string, domain: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== HTTPS) {
    return false;
  }

  const host = url.hostname.toLowerCase();

  // O dominio exato, ou um subdominio dele -- `br.linkedin.com` e `www.` sao
  // legitimos. A comparacao por `.${domain}` e o que impede `evillinkedin.com`
  // de passar por ser sufixo textual.
  return host === domain || host.endsWith(`.${domain}`);
}

export function isLinkedinUrl(value: string): boolean {
  return isUrlOf(value, 'linkedin.com');
}

export function isInstagramUrl(value: string): boolean {
  return isUrlOf(value, 'instagram.com');
}
