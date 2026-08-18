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

export function phaseOf(weekId: string, now: Date = new Date()): MuralPhase {
  const atual = weekIdOf(now);

  if (weekId === atual) {
    return 'coleta';
  }

  if (weekId === previousWeekId(atual)) {
    return 'votacao';
  }

  return 'encerrada';
}
