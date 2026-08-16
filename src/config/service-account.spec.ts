import { parseServiceAccount } from './service-account';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----\n';

function serviceAccountJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'eduleno-test',
    client_email: 'sa@eduleno-test.iam.gserviceaccount.com',
    private_key: PEM,
    ...overrides,
  });
}

describe('parseServiceAccount', () => {
  it('devolve os tres campos que o firebase-admin precisa', () => {
    const account = parseServiceAccount(serviceAccountJson());

    expect(account.projectId).toBe('eduleno-test');
    expect(account.clientEmail).toBe('sa@eduleno-test.iam.gserviceaccount.com');
    expect(account.privateKey).toBe(PEM);
  });

  it('converte \\n literal da chave privada em quebra de linha real', () => {
    // O caso que motiva o modulo: o valor atravessou .env ou painel da Vercel e
    // chegou com as sequencias de escape intactas. Sem a troca, o firebase-admin
    // estoura com PEM invalido longe daqui.
    const escaped = JSON.stringify({
      project_id: 'eduleno-test',
      client_email: 'sa@eduleno-test.iam.gserviceaccount.com',
      private_key:
        '-----BEGIN PRIVATE KEY-----\\nMIIEv\\n-----END PRIVATE KEY-----\\n',
    });

    const account = parseServiceAccount(escaped);

    expect(account.privateKey).toBe(PEM);
    expect(account.privateKey).not.toContain('\\n');
  });

  it('nao estraga a chave que ja veio com quebras de linha de verdade', () => {
    const account = parseServiceAccount(serviceAccountJson());

    expect(account.privateKey.split('\n')).toHaveLength(4);
  });

  it('falha com mensagem propria quando o JSON nao parseia', () => {
    expect(() => parseServiceAccount('{ nao é json')).toThrow(
      /nao e um JSON valido/,
    );
  });

  it('falha nomeando os campos que faltam', () => {
    const semEmail = JSON.stringify({
      project_id: 'eduleno-test',
      private_key: PEM,
    });

    expect(() => parseServiceAccount(semEmail)).toThrow(/client_email/);
  });

  it('trata campo presente porem vazio como ausente', () => {
    // String vazia passaria por um typeof === 'string' ingenuo e so quebraria
    // depois, na montagem da credencial.
    expect(() =>
      parseServiceAccount(serviceAccountJson({ project_id: '' })),
    ).toThrow(/project_id/);
  });

  it('recusa JSON que nao e objeto', () => {
    expect(() => parseServiceAccount('"uma string"')).toThrow(
      /precisa ser um objeto JSON/,
    );
  });
});
