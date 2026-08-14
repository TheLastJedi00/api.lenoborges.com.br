import {
  normalizeEmail,
  normalizePhone,
  normalizeName,
  normalizeBio,
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
});
