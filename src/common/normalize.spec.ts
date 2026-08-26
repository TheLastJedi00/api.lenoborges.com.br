import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeBio,
  normalizeSearchText,
} from './normalize';

describe('Normalize Utils', () => {
  describe('normalizeEmail', () => {
    it('should trim and lowercase email address', () => {
      expect(normalizeEmail('  Test@EMAIL.com  ')).toBe('test@email.com');
      expect(normalizeEmail('Fulano@Email.COM')).toBe('fulano@email.com');
    });
  });

  describe('normalizePhone', () => {
    it('should strip all non-digit characters', () => {
      expect(normalizePhone('(11) 99999-8888')).toBe('11999998888');
      expect(normalizePhone('+55 (47) 9999-0000')).toBe('554799990000');
    });
  });

  describe('normalizeName', () => {
    it('should trim and collapse multiple internal spaces', () => {
      expect(normalizeName('  Test   Name  ')).toBe('Test Name');
      expect(normalizeName('Fulano    de     Tal')).toBe('Fulano de Tal');
    });
  });

  describe('normalizeBio', () => {
    it('should trim leading and trailing whitespaces', () => {
      expect(normalizeBio('  Estudando back-end.  ')).toBe(
        'Estudando back-end.',
      );
    });
  });

  describe('normalizeSearchText', () => {
    it('teste-trava: acento nao separa quem procura de quem e procurado', () => {
      // Os dois lados da comparacao passam por aqui, entao "jose" tem que
      // encontrar "José" e o contrario tambem.
      expect(normalizeSearchText('José')).toBe(normalizeSearchText('jose'));
      expect(normalizeSearchText('FRANÇA')).toBe(normalizeSearchText('franca'));
      expect(normalizeSearchText('Antônio')).toBe(
        normalizeSearchText('antonio'),
      );
    });

    it('derruba a caixa e apara as pontas', () => {
      expect(normalizeSearchText('  Leno BORGES ')).toBe('leno borges');
    });

    /**
     * **Nome nulo e o estado normal de metade da base que esta busca varre.**
     * Quem criou conta e parou antes do onboarding nao tem nome nenhum, e um
     * throw aqui derrubaria a listagem inteira por causa da pessoa que o
     * recurso existe para achar.
     */
    it('teste-trava: nulo e indefinido viram string vazia, e nao excecao', () => {
      expect(normalizeSearchText(null)).toBe('');
      expect(normalizeSearchText(undefined)).toBe('');
      expect(normalizeSearchText('')).toBe('');
    });
  });
});
