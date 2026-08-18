/**
 * As treze etapas da trilha da Liga Dev, na ordem em que sao disputadas.
 *
 * Oito GYM Battles (insignias 1 a 8), quatro Elite Battles (a Elite Four) e a
 * Battle Frontier do pos-game. Ver a spec 008.
 *
 * **Esta lista tambem existe no front**, em `community.service.ts`, e a
 * duplicacao e declarada em vez de resolvida. A alternativa seria um endpoint de
 * trilha, e ele trocaria treze strings estaveis -- que so mudam se o produto
 * inteiro mudar -- por uma requisicao em toda abertura de tela. O que importa e
 * que os dois lados usem **os mesmos ids**, porque e por eles que vídeo e
 * pergunta se ligam a uma insignia.
 */
export const BADGE_IDS = [
  'logica',
  'poo',
  'git-github',
  'spring-boot',
  'html-css',
  'js-ts',
  'angular',
  'nestjs',
  'oitavas-vercel',
  'quartas-baas',
  'semifinais-docker',
  'final-gcp',
  'frontier-ia',
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

/**
 * Existe para o `badgeId` de uma URL nunca virar dado.
 *
 * A trilha e fixa e desenhada; um `badgeId` livre so serviria para criar video
 * ou pergunta orfa numa insignia com erro de digitacao, invisivel para sempre
 * porque nenhuma tela pediria aquele id.
 */
export function isBadgeId(value: string): value is BadgeId {
  return (BADGE_IDS as readonly string[]).includes(value);
}
