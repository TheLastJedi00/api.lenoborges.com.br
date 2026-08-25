// Este spec nao passa pelo Test.createTestingModule do Nest, que e quem costuma
// carregar o reflect-metadata; sem ele o class-transformer nao le os decorators.
import 'reflect-metadata';
import { validate } from './env.validation';

/**
 * Base minima de variaveis obrigatorias, para cada teste falar so do que ele testa.
 */
const baseEnv = {
  FRONTEND_URL: 'http://localhost:4200',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'eduleno-test',
    client_email: 'sa@eduleno-test.iam.gserviceaccount.com',
    private_key:
      '-----BEGIN PRIVATE KEY-----\\nMIIEv\\n-----END PRIVATE KEY-----\\n',
  }),
  FIREBASE_WEB_API_KEY: 'web-api-key',
  EMAIL_FROM: 'Liga Dev <comunidade@lenoborges.com.br>',
  EMAIL_REPLY_TO: 'leno@lenoborges.com.br',
  EMAIL_UNSUBSCRIBE_SECRET: 'segredo-de-teste',
};

describe('validate (env)', () => {
  it('aceita a configuracao minima', () => {
    expect(() => validate({ ...baseEnv })).not.toThrow();
  });

  it('falha quando falta uma variavel obrigatoria do Firebase', () => {
    const { FIREBASE_WEB_API_KEY, ...semWebApiKey } = baseEnv;
    expect(FIREBASE_WEB_API_KEY).toBeDefined();
    expect(() => validate(semWebApiKey)).toThrow();
  });

  it('falha no boot quando a chave de servico esta malformada', () => {
    // O boot e o unico lugar onde isso ainda e barato. Sem esta checagem, o
    // valor so quebraria na primeira operacao de auth, como PEM invalido dentro
    // do firebase-admin, longe da causa.
    expect(() =>
      validate({ ...baseEnv, FIREBASE_SERVICE_ACCOUNT_JSON: '{ quebrado' }),
    ).toThrow(/nao e um JSON valido/);
  });

  it('falha quando a chave de servico nao tem client_email', () => {
    expect(() =>
      validate({
        ...baseEnv,
        FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
          project_id: 'eduleno-test',
          private_key: 'x',
        }),
      }),
    ).toThrow(/client_email/);
  });

  it('aceita os tres valores validos de SameSite', () => {
    for (const sameSite of ['lax', 'strict', 'none']) {
      expect(() =>
        validate({
          ...baseEnv,
          AUTH_COOKIE_SAMESITE: sameSite,
          AUTH_COOKIE_SECURE: 'true',
        }),
      ).not.toThrow();
    }
  });

  it('recusa SameSite fora da lista, em vez de repassar o valor ao cookie', () => {
    expect(() =>
      validate({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'Lax ' }),
    ).toThrow();
    expect(() =>
      validate({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'nenhum' }),
    ).toThrow();
  });

  it('recusa SameSite=none sem Secure', () => {
    // O navegador descarta silenciosamente cookie SameSite=None sem Secure. Sem
    // esta regra, o login responde 200, o cookie nunca e gravado e todo F5
    // desloga, sem erro em log nenhum. Ver achado A4 do review da spec 005.
    expect(() =>
      validate({
        ...baseEnv,
        AUTH_COOKIE_SAMESITE: 'none',
        AUTH_COOKIE_SECURE: 'false',
      }),
    ).toThrow(/AUTH_COOKIE_SECURE/);

    expect(() =>
      validate({ ...baseEnv, AUTH_COOKIE_SAMESITE: 'none' }),
    ).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('recusa AUTH_COOKIE_SECURE fora de true e false', () => {
    expect(() => validate({ ...baseEnv, AUTH_COOKIE_SECURE: 'sim' })).toThrow();
  });
  describe('e-mail (spec 014)', () => {
    it('fora de producao, boot sem RESEND_API_KEY sobe', () => {
      // O padrao precisa ser inofensivo: sem chave o mailer loga e nao envia.
      expect(() => validate({ ...baseEnv })).not.toThrow();
    });

    it('teste-trava: em producao, boot sem RESEND_API_KEY falha', () => {
      // Uma API de producao que registra o e-mail e nao envia e um recurso
      // quebrado em silencio -- e "silencio" e literal: nada na resposta diz
      // que ninguem recebeu.
      expect(() =>
        validate({
          ...baseEnv,
          NODE_ENV: 'production',
          RESEND_WEBHOOK_SECRET: 'whsec_x',
          API_PUBLIC_URL: 'https://api.lenoborges.com.br',
        }),
      ).toThrow(/RESEND_API_KEY/);
    });

    it('em producao, boot sem RESEND_WEBHOOK_SECRET falha', () => {
      expect(() =>
        validate({
          ...baseEnv,
          NODE_ENV: 'production',
          RESEND_API_KEY: 're_x',
          API_PUBLIC_URL: 'https://api.lenoborges.com.br',
        }),
      ).toThrow(/RESEND_WEBHOOK_SECRET/);
    });

    it('em producao, boot sem API_PUBLIC_URL falha', () => {
      // Sem ela o link de descadastro de todo e-mail aponta para localhost, e
      // quem quiser sair da lista nao consegue -- o que vira denuncia de spam.
      expect(() =>
        validate({
          ...baseEnv,
          NODE_ENV: 'production',
          RESEND_API_KEY: 're_x',
          RESEND_WEBHOOK_SECRET: 'whsec_x',
        }),
      ).toThrow(/API_PUBLIC_URL/);
    });

    it('em producao com as tres, sobe', () => {
      expect(() =>
        validate({
          ...baseEnv,
          NODE_ENV: 'production',
          RESEND_API_KEY: 're_x',
          RESEND_WEBHOOK_SECRET: 'whsec_x',
          API_PUBLIC_URL: 'https://api.lenoborges.com.br',
        }),
      ).not.toThrow();
    });

    it('falha quando falta o remetente ou o segredo do descadastro', () => {
      const { EMAIL_FROM, ...semFrom } = baseEnv;
      expect(EMAIL_FROM).toBeDefined();
      expect(() => validate(semFrom)).toThrow();

      const { EMAIL_UNSUBSCRIBE_SECRET, ...semSegredo } = baseEnv;
      expect(EMAIL_UNSUBSCRIBE_SECRET).toBeDefined();
      expect(() => validate(semSegredo)).toThrow();
    });
  });
});
