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

/**
 * Recusa unica de `oobCode` morto (spec 020, decisao 5).
 *
 * `EXPIRED_OOB_CODE`, `INVALID_OOB_CODE` e `OPERATION_NOT_ALLOWED` viram **a
 * mesma frase**, e a indistinguibilidade e o comportamento, nao economia de
 * texto: distinguir expirado de invalido informaria a quem colou um codigo
 * qualquer se ele existiu algum dia.
 *
 * O caso e comum demais para merecer um erro generico -- o link de quem ja
 * definiu a senha uma vez esta morto por definicao, e clicar nele duas vezes e
 * o que a maior parte das pessoas faz -- entao a frase tem saida escrita
 * dentro dela.
 *
 * A funcao **nao recebe o erro de proposito**: nao ha ramo nenhum a escrever
 * aqui, e receber o codigo do Google seria o convite para um `if` que separa
 * expirado de invalido. O codigo fica no log de quem chama, onde e diagnostico
 * e nao oraculo, como ja acontece no `login` e no `changeEmail`.
 */
export function translateOobError(): string {
  return (
    'Esse link não vale mais. Links de senha valem uma vez só e expiram. ' +
    'Peça um novo na tela de entrar.'
  );
}
