import { CHALLENGE_BADGE_IDS, MAX_CHALLENGE_GRADE } from './games.constants';
import type { BadgeId } from '../track/track.constants';

/**
 * Ate onde o `grade` pode subir, dadas as insignias ja desbloqueadas
 * (spec 022, decisao 13 e adendo A.8).
 *
 * **O `grade` conta etapas concluidas em sequencia, e nao um conjunto arbitrario
 * de insignias** -- e essa invariante e da spec 008, anterior a esta. Completar
 * o GYM Challenge do Angular (posicao 7) com `grade: 1` rende os selos de rodada
 * e o XP das questoes, e **nao** rende `grade: 7`: o membro ganha `grade: 2`
 * quando completar o de POO.
 *
 * Mas o `badgeUnlocked` e gravado de qualquer forma, e e por isso que isto e uma
 * **cascata** e nao um `+1`: quando a vez daquela insignia finalmente chegar, as
 * rodadas ja aprovadas contam, e o `grade` avanca de uma vez ate onde puder.
 * Sem a cascata, quem conquistou 2, 3 e 4 fora de ordem e depois conquistou a 1
 * ficaria com `grade: 1` e tres insignias invisiveis -- e nada no produto
 * corrigiria isso depois.
 *
 * **Para em 8**, e o teto nao e detalhe: as posicoes 9 a 13 sao a Elite Four e a
 * Battle Frontier, que **nao tem GYM Challenge** (ponto Q.2) e continuam sendo
 * promocao manual do admin. Um `grade` que passasse de 8 por este caminho daria
 * a Elite Four de graca.
 *
 * **Nunca desce.** Recebe o `grade` atual e devolve o maior entre ele e o que a
 * cascata alcanca: insignia concedida a mao pelo admin (spec 008) nao e revogada
 * porque o membro nao jogou o questionario dela.
 */
export function nextGrade(
  currentGrade: number,
  unlocked: ReadonlySet<BadgeId>,
): number {
  let grade = currentGrade;

  while (grade < MAX_CHALLENGE_GRADE) {
    // A insignia da proxima posicao. `CHALLENGE_BADGE_IDS[grade]` porque o array
    // e base zero e a posicao e base um: com `grade: 1`, a proxima e a de indice
    // 1, que e a posicao 2.
    const next = CHALLENGE_BADGE_IDS[grade];

    if (!unlocked.has(next)) {
      break;
    }

    grade += 1;
  }

  return Math.max(currentGrade, grade);
}
