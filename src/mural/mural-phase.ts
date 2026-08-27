import { previousWeekId, weekIdOf } from './week-id';

/**
 * As tres fases de uma pergunta, derivadas e nunca gravadas.
 *
 * - `coleta`   — a semana corrente. Recebe perguntas, e **nao** recebe votos.
 * - `votacao`  — a semana anterior. Recebe votos, e nao recebe perguntas.
 * - `encerrada`— qualquer semana mais antiga. Sai do mural; a mais votada dela
 *                vira pauta de video.
 *
 * **Nao se vota na semana em coleta**, e isso e decisao, nao limitacao. Se o
 * voto abrisse junto com a pergunta, quem publicasse domingo de manha acumularia
 * sete dias de vantagem sobre quem publicasse sabado a noite, e o mural viraria
 * uma corrida de quem acorda cedo. Com a votacao atrasada em uma semana, **todas
 * as perguntas ficam expostas exatamente o mesmo tempo**.
 *
 * Esta funcao existe sozinha para a comparacao de semanas ter um dono. Sem ela,
 * tres controllers reimplementariam o mesmo `if` e um deles trocaria os sinais.
 */
export type MuralPhase = 'coleta' | 'votacao' | 'encerrada';

/**
 * O que a fase precisa saber de uma pergunta: a semana em que ela nasceu e o
 * piso que o admin levantou.
 *
 * A funcao recebe a pergunta e nao o `weekId` **de proposito** (spec 016,
 * decisao 1). Trocar a assinatura e o objetivo, e nao o efeito colateral: um
 * terceiro parametro opcional deixaria todos os chamadores compilando com a
 * fase errada, e o unico sintoma seria um mural que ignora o adiantamento em
 * uma tela e o respeita em outra.
 */
export interface PhasedQuestion {
  weekId: string;
  promotedTo: 'votacao' | 'encerrada' | null;
}

/** A escala das fases. O piso e o relogio se comparam nela. */
const ORDEM: Readonly<Record<MuralPhase, number>> = {
  coleta: 0,
  votacao: 1,
  encerrada: 2,
};

/** A fase que o relogio sozinho daria. */
function naturalPhaseOf(weekId: string, now: Date): MuralPhase {
  const atual = weekIdOf(now);

  if (weekId === atual) {
    return 'coleta';
  }

  if (weekId === previousWeekId(atual)) {
    return 'votacao';
  }

  return 'encerrada';
}

/**
 * A fase de uma pergunta: o **maior** entre a conta do relogio e o piso do
 * adiantamento (spec 016, decisao 1).
 *
 * `promotedTo` levanta o chao e nunca segura o teto. **O relogio continua sendo
 * a autoridade quando esta a frente**, que era a propriedade que a decisao 1 da
 * spec 010 protegia: uma pergunta promovida a `votacao` em agosto nao fica
 * presa em votacao para sempre, porque quando a semana dela virar a conta
 * devolve `encerrada` sozinha. Nenhum valor gravado pode ficar velho, porque
 * nenhum valor gravado decide sozinho.
 */
export function phaseOf(
  question: PhasedQuestion,
  now: Date = new Date(),
): MuralPhase {
  const natural = naturalPhaseOf(question.weekId, now);
  const piso: MuralPhase = question.promotedTo ?? 'coleta';

  return ORDEM[piso] > ORDEM[natural] ? piso : natural;
}
