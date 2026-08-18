import { phaseOf } from './mural-phase';

// Terca-feira, 2026-08-18. Semana corrente: 2026-08-16.
const AGORA = new Date('2026-08-18T12:00:00.000Z');

describe('phaseOf', () => {
  it('a semana corrente esta em coleta', () => {
    expect(phaseOf('2026-08-16', AGORA)).toBe('coleta');
  });

  it('a semana anterior esta em votacao', () => {
    expect(phaseOf('2026-08-09', AGORA)).toBe('votacao');
  });

  it('qualquer semana mais antiga esta encerrada', () => {
    expect(phaseOf('2026-08-02', AGORA)).toBe('encerrada');
    expect(phaseOf('2026-01-04', AGORA)).toBe('encerrada');
  });

  /**
   * Semana futura nao deveria existir -- o `weekId` e sempre carimbado pelo
   * servidor na escrita. Se aparecer, e dado corrompido ou relogio errado, e
   * "encerrada" e a resposta segura: some do mural em vez de aceitar voto.
   */
  it('trata semana futura como encerrada, e nao como coleta', () => {
    expect(phaseOf('2026-08-23', AGORA)).toBe('encerrada');
  });

  /**
   * O instante da virada e o que faz o ciclo ser um ciclo: no mesmo momento, a
   * semana que coletava entra em votacao e uma nova abre.
   */
  it('na virada, coleta vira votacao e a nova semana abre', () => {
    const depois = new Date('2026-08-23T03:00:00.000Z');

    expect(phaseOf('2026-08-16', depois)).toBe('votacao');
    expect(phaseOf('2026-08-23', depois)).toBe('coleta');
    expect(phaseOf('2026-08-09', depois)).toBe('encerrada');
  });
});
