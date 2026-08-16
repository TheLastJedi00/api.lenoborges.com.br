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
});
