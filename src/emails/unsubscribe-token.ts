import { createHmac, timingSafeEqual } from 'crypto';

/**
 * O token do link de descadastro (spec 014, decisão 9).
 *
 * `{uid}.{assinatura}`, com HMAC-SHA256 sobre o `uid` e o segredo de ambiente.
 * O endpoint que o consome é **público**, não exige sessão, e o token **não
 * expira**.
 *
 * Exigir login para descadastrar é a prática que gera denúncia de spam: quem
 * quer sair não vai lembrar a senha, e o botão que ele encontra primeiro é o
 * "marcar como spam" do próprio cliente de e-mail — que custa reputação de
 * domínio, ao contrário do descadastro, que não custa nada.
 *
 * **Não expira** porque um link de descadastro morto é pior que o risco que ele
 * carrega, e o risco é pequeno e nomeado: quem tiver o link descadastra aquele
 * endereço, e o dano máximo é alguém deixar de receber e-mail que pode religar
 * em Meu Perfil.
 */

/** `base64url` para o token caber numa URL sem escapar nada. */
function sign(uid: string, secret: string): string {
  return createHmac('sha256', secret).update(uid).digest('base64url');
}

export function signUnsubscribeToken(uid: string, secret: string): string {
  return `${Buffer.from(uid).toString('base64url')}.${sign(uid, secret)}`;
}

/**
 * Devolve o `uid` quando a assinatura confere, e `null` quando não.
 *
 * **A comparação é em tempo constante.** Comparar HMAC com `===` vaza o prefixo
 * correto pelo tempo de resposta, e o atacante monta a assinatura byte a byte —
 * é a falha que parece paranoia até alguém escrever o script.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): string | null {
  const partes = token.split('.');
  if (partes.length !== 2) {
    return null;
  }

  const [uidCodificado, assinatura] = partes;

  let uid: string;
  try {
    uid = Buffer.from(uidCodificado, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  if (!uid) {
    return null;
  }

  const esperada = Buffer.from(sign(uid, secret));
  const recebida = Buffer.from(assinatura);

  // `timingSafeEqual` exige o mesmo comprimento, e um token adulterado no
  // tamanho estouraria em vez de devolver falso.
  if (esperada.length !== recebida.length) {
    return null;
  }

  return timingSafeEqual(esperada, recebida) ? uid : null;
}
