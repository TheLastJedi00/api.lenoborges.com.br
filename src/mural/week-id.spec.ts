import { previousWeekId, weekEndsAt, weekIdOf } from './week-id';

/**
 * Todos os casos fixam o relogio. Nenhum pode depender de quando a suite roda --
 * um teste de calendario que passa em agosto e falha em janeiro e pior que
 * nenhum, porque so quebra quando ninguem esta olhando.
 */
describe('weekIdOf', () => {
  // 2026-08-18 e uma terca-feira. O domingo daquela semana e 2026-08-16.
  it('devolve o domingo que abre a semana', () => {
    expect(weekIdOf(new Date('2026-08-18T12:00:00.000Z'))).toBe('2026-08-16');
  });

  it('trata o proprio domingo como abertura da semana dele', () => {
    expect(weekIdOf(new Date('2026-08-16T15:00:00.000Z'))).toBe('2026-08-16');
  });

  /**
   * A virada e meia-noite em Sao Paulo, e nao em UTC. Estes dois casos sao os
   * que denunciam alguem trocar o fuso por UTC "porque da na mesma".
   *
   * 2026-08-23T02:59 UTC ainda e sabado 23:59 em Sao Paulo (UTC-3).
   */
  it('vira na meia-noite de Sao Paulo, nao na de UTC', () => {
    expect(weekIdOf(new Date('2026-08-23T02:59:00.000Z'))).toBe('2026-08-16');
    expect(weekIdOf(new Date('2026-08-23T03:00:00.000Z'))).toBe('2026-08-23');
  });

  /**
   * A virada de ano e onde numeracao de semana costuma quebrar. Aqui o
   * identificador e a data do domingo, entao dezembro e janeiro nao tem nada de
   * especial -- e este teste existe para continuar assim.
   */
  it('atravessa a virada de ano sem caso especial', () => {
    // 2026-12-31 e quinta. O domingo daquela semana e 2026-12-27.
    expect(weekIdOf(new Date('2026-12-31T12:00:00.000Z'))).toBe('2026-12-27');
    // 2027-01-01 e sexta, mesma semana.
    expect(weekIdOf(new Date('2027-01-01T12:00:00.000Z'))).toBe('2026-12-27');
    // 2027-01-03 e domingo: semana nova.
    expect(weekIdOf(new Date('2027-01-03T12:00:00.000Z'))).toBe('2027-01-03');
  });

  it('e estavel para instantes distantes do mesmo dia', () => {
    const manha = weekIdOf(new Date('2026-08-18T09:00:00.000Z'));
    const noite = weekIdOf(new Date('2026-08-19T01:00:00.000Z'));

    // 2026-08-19T01:00 UTC e ainda 2026-08-18 22:00 em Sao Paulo.
    expect(manha).toBe(noite);
  });
});

describe('previousWeekId', () => {
  it('anda exatamente sete dias para tras', () => {
    expect(previousWeekId('2026-08-16')).toBe('2026-08-09');
  });

  it('atravessa a virada de ano', () => {
    expect(previousWeekId('2027-01-03')).toBe('2026-12-27');
  });
});

describe('weekEndsAt', () => {
  /**
   * O instante da virada e meia-noite em Sao Paulo, que hoje sao 03:00 UTC.
   * Construir isso sobre meia-noite UTC erra por tres horas -- e o sintoma so
   * aparece para quem olha a tela de madrugada.
   */
  it('devolve a meia-noite de Sao Paulo do domingo seguinte', () => {
    expect(weekEndsAt('2026-08-16').toISOString()).toBe(
      '2026-08-23T03:00:00.000Z',
    );
  });

  it('o fim de uma semana e o comeco da seguinte', () => {
    const fim = weekEndsAt('2026-08-16');

    expect(weekIdOf(fim)).toBe('2026-08-23');
  });
});
