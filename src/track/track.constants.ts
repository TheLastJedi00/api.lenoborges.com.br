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
 * O nome legivel de cada etapa.
 *
 * **Esta e a segunda copia dos titulos, e ela so passou a existir na spec 014.**
 * Ate aqui o backend so precisava dos ids: quem traduzia id em nome era o front,
 * que tem o `community.service.ts` e uma tela para renderizar. **E-mail nao tem
 * renderer** -- o texto sai daqui pronto e chega numa caixa de entrada --, entao
 * o nome precisa existir deste lado.
 *
 * O que **nao** pode divergir sao os ids, que sao o vinculo entre video,
 * pergunta e insignia. Um titulo fora de sincronia produz um e-mail com o nome
 * antigo; um id fora de sincronia produz conteudo orfao.
 */
export const BADGE_TITLES: Readonly<Record<BadgeId, string>> = {
  logica: 'Insígnia da Lógica',
  poo: 'Insígnia da POO',
  'git-github': 'Insígnia do Git e GitHub',
  'spring-boot': 'Insígnia do Spring Boot',
  'html-css': 'Insígnia do HTML e CSS',
  'js-ts': 'Insígnia do JavaScript e TypeScript',
  angular: 'Insígnia do Angular',
  nestjs: 'Insígnia do NestJS',
  'oitavas-vercel': 'Oitavas de Final: Vercel',
  'quartas-baas': 'Quartas de Final: Firebase e Supabase',
  'semifinais-docker': 'Semifinais: Docker',
  'final-gcp': 'Final: Google Cloud Platform',
  'frontier-ia': 'Battle Frontier: IA Aplicada ao Desenvolvimento',
};

/**
 * Quanto vale marcar um video como assistido (spec 019, decisao 7).
 *
 * **Um lugar so, e do lado do servidor.** O front recebe o `xp` pronto em toda
 * resposta que o carrega e **nao conhece este numero** -- e a mesma regra da
 * `orientation` da spec 017 e da `phase` do Mural: o servidor afirma, a tela
 * obedece.
 *
 * A tentacao do outro lado e somar 10 no signal para a tela responder mais
 * rapido. Ela erra: **remarcar um video nao paga XP nenhum** (decisao 2), entao
 * a soma local acerta no primeiro clique de cada video e erra em todos os
 * seguintes -- e o erro so aparece quando alguem recarrega a pagina e ve o
 * numero cair.
 *
 * O dia em que um video valer 20, ou em que a insignia final valer o dobro, e
 * este arquivo que muda, e nenhum front precisa ser encontrado.
 */
export const XP_PER_VIDEO = 10;

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
