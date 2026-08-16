/**
 * Leitura da chave de servico do Firebase, que chega como JSON de uma linha so
 * em FIREBASE_SERVICE_ACCOUNT_JSON.
 *
 * Existe como modulo proprio porque duas camadas precisam do mesmo resultado: a
 * validacao de ambiente, que derruba o boot com mensagem clara quando o valor
 * esta malformado, e o FirebaseService, que monta a credencial. Repetir o parse
 * nos dois lugares repetiria tambem a normalizacao da chave privada, que e o
 * unico ponto delicado daqui.
 */
export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * A chave privada e um PEM, ou seja, um texto com quebras de linha. Dentro do
 * JSON serializado elas viram a sequencia de dois caracteres `\` + `n`, e
 * dependendo de como o valor atravessa .env, painel da Vercel e JSON.parse, pode
 * chegar aqui ainda como texto literal em vez de quebra de linha de verdade.
 *
 * O sintoma de nao tratar isso e um erro de PEM invalido la dentro do
 * firebase-admin, longe da causa. Trocar aqui e barato e cobre os dois casos: se
 * o JSON.parse ja resolveu as sequencias, nao ha o que substituir.
 */
function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, '\n');
}

export function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON nao e um JSON valido. ' +
        'Esperado o conteudo do arquivo de chave de servico do Firebase em uma linha so.',
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON precisa ser um objeto JSON.',
    );
  }

  const candidate = parsed as Record<string, unknown>;
  const missing = ['project_id', 'client_email', 'private_key'].filter(
    (field) => typeof candidate[field] !== 'string' || !candidate[field],
  );

  if (missing.length > 0) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON esta sem os campos: ${missing.join(', ')}. ` +
        'Baixe a chave em Project settings > Service accounts.',
    );
  }

  return {
    projectId: candidate.project_id as string,
    clientEmail: candidate.client_email as string,
    privateKey: normalizePrivateKey(candidate.private_key as string),
  };
}
