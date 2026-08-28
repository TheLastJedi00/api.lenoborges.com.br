import {
  translateOobError,
  translatePasswordError,
} from './password-errors';
import { FirebaseRestError } from './firebase.service';

describe('password-errors', () => {
  describe('translatePasswordError', () => {
    it('traduz a recusa da politica de senha do console', () => {
      expect(
        translatePasswordError(new FirebaseRestError('WEAK_PASSWORD : ...', 400)),
      ).toBe('A nova senha não atende à política de segurança do projeto.');

      expect(
        translatePasswordError(
          new FirebaseRestError('PASSWORD_DOES_NOT_MEET_REQUIREMENTS : ...', 400),
        ),
      ).toBe('A nova senha não atende à política de segurança do projeto.');
    });

    it('traduz o token vencido da reautenticacao', () => {
      expect(
        translatePasswordError(new FirebaseRestError('TOKEN_EXPIRED', 400)),
      ).toBe('Sessão expirada. Entre de novo e tente outra vez.');
    });

    it('cai numa recusa generica para codigo desconhecido', () => {
      expect(translatePasswordError(new Error('QUALQUER_OUTRA_COISA'))).toBe(
        'Não foi possível trocar a senha.',
      );
    });

    it('nao deixa o codigo do Google vazar em nenhuma das mensagens', () => {
      // O codigo e diagnostico e vai para o log; a resposta nunca o carrega.
      for (const code of [
        'WEAK_PASSWORD : Password should be at least 8 characters',
        'PASSWORD_DOES_NOT_MEET_REQUIREMENTS',
        'TOKEN_EXPIRED',
        'INVALID_ID_TOKEN',
        'ALGO_NOVO_DO_GOOGLE',
      ]) {
        expect(translatePasswordError(new Error(code))).not.toContain('_');
      }
    });
  });

  describe('translateOobError', () => {
    /**
     * O teste-trava da decisao 5 da spec 020.
     *
     * Expirado e invalido sao **indistinguiveis na resposta**, e nao por
     * economia de texto: distinguir informaria a quem colou um codigo qualquer
     * se ele existiu algum dia. O dia em que alguem "melhorar" a mensagem
     * separando os casos, este teste fica vermelho.
     */
    it('devolve a mesma frase para expirado, invalido e nao permitido', () => {
      const expirado = translateOobError();
      const invalido = translateOobError();
      const naoPermitido = translateOobError();

      expect(expirado).toBe(invalido);
      expect(invalido).toBe(naoPermitido);
    });

    it('a frase diz que o link acabou e tem saida escrita dentro dela', () => {
      // O caso e comum demais para um erro generico: o link de quem ja definiu
      // a senha uma vez esta morto por definicao.
      expect(translateOobError()).toBe(
        'Esse link não vale mais. Links de senha valem uma vez só e expiram. ' +
          'Peça um novo na tela de entrar.',
      );
    });

    it('nao carrega o codigo do Google', () => {
      expect(translateOobError()).not.toMatch(/OOB_CODE|OPERATION_NOT_ALLOWED/);
    });
  });
});
