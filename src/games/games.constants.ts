import { BADGE_IDS, BadgeId } from '../track/track.constants';

/**
 * As regras numericas do GYM Challenge (spec 022).
 *
 * **Um arquivo so, do lado do servidor, e nenhum destes numeros atravessa para o
 * front.** E a mesma regra do `XP_PER_VIDEO` da spec 019 e da `orientation` da
 * spec 017: o servidor afirma, a tela obedece. O front recebe `xpAwarded` pronto
 * em cada resposta e nao sabe de onde ele veio -- e num questionario isso deixa
 * de ser elegancia e vira seguranca, porque a formula na tela e meio caminho
 * para o placar na tela.
 */

/** A dificuldade de uma questao, e tambem a de uma rodada inteira. */
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = [
  'easy',
  'medium',
  'hard',
] as const;

/** As tres rodadas, na ordem em que sao disputadas. */
export type RoundNumber = 1 | 2 | 3;

export const ROUND_NUMBERS: readonly RoundNumber[] = [1, 2, 3] as const;

/**
 * Quantas questoes cada rodada apresenta (decisao 1).
 *
 * Dez e o numero que faz `PASSING_SCORE` ser legivel: "acertar 7 de 10" cabe na
 * cabeca de quem joga. Mudar isto sem mudar o corte muda a regra do jogo em
 * silencio.
 */
export const QUESTIONS_PER_ROUND = 10;

/** Quantos acertos aprovam a rodada (decisao 2). */
export const PASSING_SCORE = 7;

/**
 * O XP base de uma questao acertada, antes da penalidade de tempo (decisao 3).
 *
 * **Este e o numero que a spec proibe o front de conhecer.** Ele existe aqui e
 * em nenhum outro lugar; o dia em que uma insignia valer o dobro, e este arquivo
 * que muda e nenhum front precisa ser encontrado.
 */
export const XP_PER_CORRECT_ANSWER = 50;

/**
 * Os segundos iniciais que nao custam XP nenhum (decisao 3).
 *
 * Existe para ler o enunciado nao ser penalidade. Sem esta janela, a questao
 * mais bem escrita -- que e a mais longa -- seria a que menos paga.
 */
export const FREE_SECONDS = 5;

/**
 * O piso da recompensa: quem acerta recebe (decisao 3).
 *
 * **Nunca zero, nunca negativo.** Zero transformaria o acerto lento em erro, e
 * o membro que pensou muito e chegou na resposta certa aprendeu mais do que o
 * que chutou rapido.
 */
export const MIN_XP_PER_ANSWER = 1;

/**
 * A folga que o tempo do cliente pode ter sobre o do servidor (decisao 3).
 *
 * O `clientElapsedMs` e aceito quando esta entre zero e `tempoServidor + 2s`.
 * Fora dessa faixa o relogio do cliente esta mentindo ou dessincronizado, e o
 * do servidor prevalece. **Dois segundos e folga de relogio, nao de rede** -- a
 * rede so faz o servidor medir mais, e medir mais nunca prejudica o membro,
 * porque o calculo usa o `min` dos dois.
 */
export const CLIENT_ELAPSED_TOLERANCE_SECONDS = 2;

/**
 * Quantas questoes por dificuldade o admin precisa cadastrar para o desafio
 * existir (decisao 5).
 *
 * Trinta por nivel, noventa no total. Abaixo disso o card fica em "Em breve" --
 * e o motivo nao e burocracia: com menos que isso o sorteio de 10 repetiria as
 * mesmas questoes entre tentativas, e a segunda tentativa viraria memorizacao
 * em vez de conhecimento.
 */
export const MIN_QUESTIONS_PER_DIFFICULTY = 30;

/** O teto por dificuldade (decisao 5). Trinta e tres por nivel, 99 no total. */
export const MAX_QUESTIONS_PER_DIFFICULTY = 33;

/** Qual dificuldade cada rodada sorteia (decisao 2). */
export const ROUND_DIFFICULTY: Readonly<Record<RoundNumber, Difficulty>> = {
  1: 'easy',
  2: 'medium',
  3: 'hard',
};

/**
 * As insignias que tem GYM Challenge: as **oito primeiras**, e so elas.
 *
 * A Elite Four (posicoes 9 a 12) e a Battle Frontier (13) ficam de fora por
 * decisao explicita (ponto Q.2), e a mecanica delas sera outra. Derivar esta
 * lista de `BADGE_IDS` com um `slice` -- em vez de reescrever os oito ids --
 * garante que ela nunca divirja da trilha na ordem, que e o que a decisao 13
 * usa para saber qual insignia e "a proxima".
 */
export const CHALLENGE_BADGE_IDS = BADGE_IDS.slice(0, 8) as readonly BadgeId[];

/**
 * O teto do `grade` que o GYM Challenge pode conceder (decisao 13, adendo A.8).
 *
 * A cascata avanca enquanto a insignia da posicao seguinte estiver desbloqueada
 * e **para aqui**. Um `grade` que passasse de 8 por este caminho daria a Elite
 * Four de graca, que e exatamente o que a Q.2 fechou que nao acontece.
 */
export const MAX_CHALLENGE_GRADE = CHALLENGE_BADGE_IDS.length;

/** Se esta insignia tem GYM Challenge. Mesmo papel do `isBadgeId` da trilha. */
export function isChallengeBadgeId(value: string): value is BadgeId {
  return (CHALLENGE_BADGE_IDS as readonly string[]).includes(value);
}

/**
 * A posicao da insignia na trilha, comecando em 1.
 *
 * **E o numero que o `grade` conta**, e e por isso que ele sai da ordem de
 * `CHALLENGE_BADGE_IDS` e nao de um campo gravado: a ordem da trilha e a mesma
 * coisa que a sequencia do `grade`, e duas fontes para o mesmo fato divergem na
 * primeira reordenacao.
 */
export function challengeBadgePosition(badgeId: string): number {
  return (CHALLENGE_BADGE_IDS as readonly string[]).indexOf(badgeId) + 1;
}
