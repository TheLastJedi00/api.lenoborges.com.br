/**
 * Constantes do ciclo semanal do Mural (spec 010).
 */

/**
 * O fuso é fixo, é do servidor, e não é negociável.
 *
 * "Domingo" para este público é domingo brasileiro. Deixar o cliente decidir
 * faria quem está com o fuso errado no celular — ou viajando — ver uma virada
 * que não existe, votar e receber 409.
 *
 * O Brasil não tem horário de verão desde 2019, então o cálculo é estável. Se
 * um dia voltar, é aqui que a conta precisa ser reexaminada.
 */
export const MURAL_TIMEZONE = 'America/Sao_Paulo';

/** Tamanhos do texto de uma pergunta. Ver a decisão 10 da spec 010. */
export const QUESTION_TITLE_MIN = 10;
export const QUESTION_TITLE_MAX = 140;
export const QUESTION_BODY_MAX = 1000;
