import { BADGE_IDS } from '../track/track.constants';
import {
  CHALLENGE_BADGE_IDS,
  MAX_CHALLENGE_GRADE,
  MIN_QUESTIONS_PER_DIFFICULTY,
  MAX_QUESTIONS_PER_DIFFICULTY,
  PASSING_SCORE,
  QUESTIONS_PER_ROUND,
  ROUND_DIFFICULTY,
  challengeBadgePosition,
  isChallengeBadgeId,
} from './games.constants';

describe('games.constants', () => {
  describe('CHALLENGE_BADGE_IDS', () => {
    // Este teste existe para impedir a Elite Four de ganhar desafio por
    // acidente (ponto Q.2). Um `slice(0, 9)` distraido daria a insignia das
    // oitavas de final a quem completasse um questionario, e nada em tela
    // denunciaria isso -- o card apareceria e funcionaria.
    it('tem exatamente as oito primeiras insignias da trilha', () => {
      expect(CHALLENGE_BADGE_IDS).toHaveLength(8);
      expect([...CHALLENGE_BADGE_IDS]).toEqual([...BADGE_IDS].slice(0, 8));
    });

    it('nao inclui a Elite Four nem a Battle Frontier', () => {
      for (const badgeId of [
        'oitavas-vercel',
        'quartas-baas',
        'semifinais-docker',
        'final-gcp',
        'frontier-ia',
      ]) {
        expect(isChallengeBadgeId(badgeId)).toBe(false);
      }
    });

    it('so aceita ids que existem na trilha', () => {
      for (const badgeId of CHALLENGE_BADGE_IDS) {
        expect(BADGE_IDS).toContain(badgeId);
      }
    });
  });

  describe('challengeBadgePosition', () => {
    // A posicao e o numero que o `grade` conta (decisao 13). Ela sai da ordem
    // da lista, e nao de um campo gravado, para que reordenar a trilha nao
    // deixe duas fontes discordando de qual insignia e a proxima.
    it('conta a partir de 1, na ordem da trilha', () => {
      expect(challengeBadgePosition('logica')).toBe(1);
      expect(challengeBadgePosition('poo')).toBe(2);
      expect(challengeBadgePosition('nestjs')).toBe(8);
    });

    it('devolve 0 para insignia sem desafio', () => {
      expect(challengeBadgePosition('final-gcp')).toBe(0);
    });
  });

  describe('regras numericas', () => {
    it('aprova com 7 de 10', () => {
      expect(QUESTIONS_PER_ROUND).toBe(10);
      expect(PASSING_SCORE).toBe(7);
      expect(PASSING_SCORE).toBeLessThanOrEqual(QUESTIONS_PER_ROUND);
    });

    it('exige mais questoes por nivel do que uma rodada consome', () => {
      // Sortear 10 de um banco de 10 e servir sempre as mesmas: a segunda
      // tentativa viraria memorizacao. E a razao do minimo de 30 (decisao 5).
      expect(MIN_QUESTIONS_PER_DIFFICULTY).toBeGreaterThan(QUESTIONS_PER_ROUND);
      expect(MAX_QUESTIONS_PER_DIFFICULTY).toBeGreaterThanOrEqual(
        MIN_QUESTIONS_PER_DIFFICULTY,
      );
    });

    it('progride facil, media e dificil nas tres rodadas', () => {
      expect(ROUND_DIFFICULTY).toEqual({
        1: 'easy',
        2: 'medium',
        3: 'hard',
      });
    });

    it('limita o grade concedido pelo desafio ao numero de insignias', () => {
      expect(MAX_CHALLENGE_GRADE).toBe(CHALLENGE_BADGE_IDS.length);
      expect(MAX_CHALLENGE_GRADE).toBe(8);
    });
  });
});
