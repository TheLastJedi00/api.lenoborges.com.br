import { nextGrade } from './grade-progression';
import { CHALLENGE_BADGE_IDS } from './games.constants';
import type { BadgeId } from '../track/track.constants';

function unlocked(...ids: BadgeId[]): ReadonlySet<BadgeId> {
  return new Set(ids);
}

describe('nextGrade', () => {
  it('teste-trava: conquistar fora de ordem nao avanca o grade', () => {
    // **A invariante da spec 008**, que esta spec nao pode quebrar: `grade` conta
    // etapas concluidas em sequencia, e nao um conjunto arbitrario de insignias.
    // Um membro com grade 1 que completa o de Angular (posicao 7) ganha os selos
    // de rodada e o XP das questoes, e nao ganha grade 7.
    expect(nextGrade(1, unlocked('angular'))).toBe(1);
  });

  it('conquistar a proxima da ordem avanca uma posicao', () => {
    expect(nextGrade(1, unlocked('poo'))).toBe(2);
  });

  it('quem tem grade 0 avanca ao conquistar a primeira', () => {
    expect(nextGrade(0, unlocked('logica'))).toBe(1);
  });

  it('teste-trava: a cascata cobra as conquistas fora de ordem quando chega a vez', () => {
    // **A razao de isto ser cascata e nao `+1`.** Quem conquistou 2, 3 e 4 fora
    // de ordem e depois conquistou a 1 ficaria com grade 1 e tres insignias
    // invisiveis -- e nada no produto corrigiria isso depois.
    expect(
      nextGrade(0, unlocked('logica', 'poo', 'git-github', 'spring-boot')),
    ).toBe(4);
  });

  it('a cascata para no primeiro buraco', () => {
    // 1, 2 e 4 desbloqueadas: para em 2, porque a 3 falta.
    expect(nextGrade(0, unlocked('logica', 'poo', 'spring-boot'))).toBe(2);
  });

  it('teste-trava: para em 8, e nao entrega a Elite Four', () => {
    // As posicoes 9 a 13 nao tem GYM Challenge (Q.2) e continuam sendo promocao
    // manual. Um grade que passasse de 8 por este caminho daria a Elite Four de
    // graca a quem so respondeu questionario.
    expect(nextGrade(0, unlocked(...CHALLENGE_BADGE_IDS))).toBe(8);
    expect(nextGrade(8, unlocked(...CHALLENGE_BADGE_IDS))).toBe(8);
  });

  it('teste-trava: nunca desce', () => {
    // Insignia concedida a mao pelo admin (spec 008) nao e revogada porque o
    // membro nao jogou o questionario dela. O `grade` que ja existe e um piso.
    expect(nextGrade(5, unlocked())).toBe(5);
    expect(nextGrade(12, unlocked('logica'))).toBe(12);
  });

  it('nao avanca sem nenhuma insignia desbloqueada', () => {
    expect(nextGrade(0, unlocked())).toBe(0);
    expect(nextGrade(3, unlocked())).toBe(3);
  });

  it('o membro que ja passou de 8 fica onde esta', () => {
    // Elite Four em diante e territorio do admin. A cascata nao mexe.
    expect(nextGrade(11, unlocked(...CHALLENGE_BADGE_IDS))).toBe(11);
  });
});
