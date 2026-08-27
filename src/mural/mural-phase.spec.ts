import { phaseOf } from './mural-phase';

// Terca-feira, 2026-08-18. Semana corrente: 2026-08-16.
const AGORA = new Date('2026-08-18T12:00:00.000Z');

/** A pergunta, reduzida ao que a fase precisa saber dela. */
function pergunta(
  weekId: string,
  promotedTo: 'votacao' | 'encerrada' | null = null,
) {
  return { weekId, promotedTo };
}

describe('phaseOf', () => {
  it('a semana corrente esta em coleta', () => {
    expect(phaseOf(pergunta('2026-08-16'), AGORA)).toBe('coleta');
  });

  it('a semana anterior esta em votacao', () => {
    expect(phaseOf(pergunta('2026-08-09'), AGORA)).toBe('votacao');
  });

  it('qualquer semana mais antiga esta encerrada', () => {
    expect(phaseOf(pergunta('2026-08-02'), AGORA)).toBe('encerrada');
    expect(phaseOf(pergunta('2026-01-04'), AGORA)).toBe('encerrada');
  });

  /**
   * Semana futura nao deveria existir -- o `weekId` e sempre carimbado pelo
   * servidor na escrita. Se aparecer, e dado corrompido ou relogio errado, e
   * "encerrada" e a resposta segura: some do mural em vez de aceitar voto.
   */
  it('trata semana futura como encerrada, e nao como coleta', () => {
    expect(phaseOf(pergunta('2026-08-23'), AGORA)).toBe('encerrada');
  });

  /**
   * O instante da virada e o que faz o ciclo ser um ciclo: no mesmo momento, a
   * semana que coletava entra em votacao e uma nova abre.
   */
  it('na virada, coleta vira votacao e a nova semana abre', () => {
    const depois = new Date('2026-08-23T03:00:00.000Z');

    expect(phaseOf(pergunta('2026-08-16'), depois)).toBe('votacao');
    expect(phaseOf(pergunta('2026-08-23'), depois)).toBe('coleta');
    expect(phaseOf(pergunta('2026-08-09'), depois)).toBe('encerrada');
  });

  describe('o piso do adiantamento (spec 016)', () => {
    it('levanta o chao: pergunta em coleta promovida a votacao esta em votacao', () => {
      expect(phaseOf(pergunta('2026-08-16', 'votacao'), AGORA)).toBe('votacao');
    });

    it('pergunta em coleta promovida a encerrada pula a votacao inteira', () => {
      expect(phaseOf(pergunta('2026-08-16', 'encerrada'), AGORA)).toBe(
        'encerrada',
      );
    });

    /**
     * **O teste que prova que promocao e piso, e nao estado gravado.**
     *
     * Uma pergunta de tres semanas atras promovida a `votacao` ja encerrou pelo
     * relogio, e o relogio ganha quando esta a frente. Um campo `status`
     * gravado responderia `votacao` aqui -- e o mural mostraria em votacao uma
     * pergunta de tres semanas atras, sem erro e sem alarme.
     */
    it('o relogio ganha quando esta a frente do piso', () => {
      expect(phaseOf(pergunta('2026-07-26', 'votacao'), AGORA)).toBe(
        'encerrada',
      );
    });

    it('promover para a fase em que a pergunta ja esta nao muda nada', () => {
      expect(phaseOf(pergunta('2026-08-09', 'votacao'), AGORA)).toBe('votacao');
    });

    /**
     * A compatibilidade com tudo que existia antes da spec 016: sem promocao, a
     * resposta e exatamente a da versao antiga, nos tres casos.
     */
    it('sem promocao, responde o que a versao antiga respondia', () => {
      expect(phaseOf(pergunta('2026-08-16', null), AGORA)).toBe('coleta');
      expect(phaseOf(pergunta('2026-08-09', null), AGORA)).toBe('votacao');
      expect(phaseOf(pergunta('2026-08-02', null), AGORA)).toBe('encerrada');
    });
  });
});
