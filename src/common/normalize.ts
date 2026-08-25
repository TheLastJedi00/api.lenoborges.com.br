export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeBio(bio: string): string {
  return bio.trim();
}

/**
 * Texto pronto para comparar (spec 015, decisão 5).
 *
 * Minúsculas e **acentos removidos** dos dois lados da comparação: "jose" acha
 * "José", "BORGES" acha "Borges". A remoção é `NFD` mais o descarte dos
 * diacríticos, que é o caminho que não precisa de tabela de substituição — e
 * tabela de substituição é onde alguém esquece o "ç" e a busca por "franca" para
 * de achar "França" sem ninguém notar.
 *
 * **Aceita nulo e devolve string vazia**, porque nome nulo é o estado normal de
 * metade da base que esta busca varre: quem criou conta e parou antes do
 * onboarding não tem nome nenhum, e é justamente quem o admin procura.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
