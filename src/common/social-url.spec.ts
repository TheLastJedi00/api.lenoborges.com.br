import { isInstagramUrl, isLinkedinUrl } from './social-url';

describe('social-url', () => {
  describe('isLinkedinUrl', () => {
    it('aceita a URL de perfil, com e sem www', () => {
      expect(isLinkedinUrl('https://linkedin.com/in/fulano')).toBe(true);
      expect(isLinkedinUrl('https://www.linkedin.com/in/fulano')).toBe(true);
    });

    it('aceita subdominio de pais', () => {
      expect(isLinkedinUrl('https://br.linkedin.com/in/fulano')).toBe(true);
    });

    it('teste-trava: dominio no query string nao vale dominio', () => {
      // Quem valida por `includes` aceita esta linha e cria um campo de link
      // aberto. E o unico caso que precisa continuar recusado para sempre.
      expect(isLinkedinUrl('https://evil.com/?u=linkedin.com')).toBe(false);
    });

    it('recusa sufixo textual que nao e subdominio', () => {
      expect(isLinkedinUrl('https://evillinkedin.com/in/fulano')).toBe(false);
    });

    it('recusa http, texto solto e handle', () => {
      expect(isLinkedinUrl('http://linkedin.com/in/fulano')).toBe(false);
      expect(isLinkedinUrl('linkedin.com/in/fulano')).toBe(false);
      expect(isLinkedinUrl('@fulano')).toBe(false);
      expect(isLinkedinUrl('')).toBe(false);
    });

    it('recusa a outra rede', () => {
      expect(isLinkedinUrl('https://instagram.com/fulano')).toBe(false);
    });
  });

  describe('isInstagramUrl', () => {
    it('aceita a URL de perfil, com e sem www', () => {
      expect(isInstagramUrl('https://instagram.com/fulano')).toBe(true);
      expect(isInstagramUrl('https://www.instagram.com/fulano')).toBe(true);
    });

    it('teste-trava: dominio no query string nao vale dominio', () => {
      expect(isInstagramUrl('https://evil.com/?u=instagram.com')).toBe(false);
    });

    it('recusa a outra rede', () => {
      expect(isInstagramUrl('https://linkedin.com/in/fulano')).toBe(false);
    });
  });
});
