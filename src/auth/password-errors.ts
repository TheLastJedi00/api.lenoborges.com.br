/**
 * Traducao das recusas que o Identity Toolkit devolve sobre senha e sobre
 * `oobCode`.
 *
 * Mora aqui, e nao dentro de um service, porque a partir da spec 020 sao **dois
 * fluxos** que precisam da mesma tradução: `POST /me/password` (logado,
 * `ProfileService`) e `POST /auth/password` (por link, `AuthService`).
 * Duplicá-la é o que faz as duas mensagens divergirem na primeira vez que
 * alguém melhorar uma delas.
 */

/** Codigo do Google que veio dentro do FirebaseRestError, ou o erro cru. */
function codeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Traduz a recusa de senha do Identity Toolkit.
 *
 * O piso real e a politica do console (Authentication > Settings > Password
 * policy), nao o `@MinLength` do DTO: o Google recusa a senha fraca mesmo
 * quando o decorator deixou passar, e e esta mensagem que a pessoa le.
 */
export function translatePasswordError(error: unknown): string {
  const code = codeOf(error);

  if (code.startsWith('WEAK_PASSWORD') || code.startsWith('PASSWORD_DOES')) {
    return 'A nova senha não atende à política de segurança do projeto.';
  }
  if (code.startsWith('TOKEN_EXPIRED') || code.startsWith('INVALID_ID_TOKEN')) {
    return 'Sessão expirada. Entre de novo e tente outra vez.';
  }

  return 'Não foi possível trocar a senha.';
}
