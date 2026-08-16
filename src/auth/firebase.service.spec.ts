import { ConfigService } from '@nestjs/config';

const initializeAppMock = jest.fn(() => ({ name: 'test-app' }));
const getAppsMock = jest.fn(() => [] as unknown[]);
const getAppMock = jest.fn(() => ({ name: 'test-app' }));
const certMock = jest.fn((credential: unknown) => ({ credential }));
const getAuthMock = jest.fn(() => ({ name: 'auth' }));
const initializeFirestoreMock = jest.fn(() => ({ name: 'firestore' }));
const getFirestoreMock = jest.fn(() => ({ name: 'firestore' }));

jest.mock('firebase-admin/app', () => ({
  initializeApp: (...args: unknown[]) => initializeAppMock(...(args as [])),
  getApps: () => getAppsMock(),
  getApp: () => getAppMock(),
  cert: (credential: unknown) => certMock(credential),
}));

jest.mock('firebase-admin/auth', () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...(args as [])),
}));

jest.mock('firebase-admin/firestore', () => ({
  initializeFirestore: (...args: unknown[]) =>
    initializeFirestoreMock(...(args as [])),
  getFirestore: (...args: unknown[]) => getFirestoreMock(...(args as [])),
}));

import { FirebaseService } from './firebase.service';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----\n';

function configWith(serviceAccountJson: string): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => {
      switch (key) {
        case 'FIREBASE_SERVICE_ACCOUNT_JSON':
          return serviceAccountJson;
        case 'FIREBASE_WEB_API_KEY':
          return 'web-api-key';
        default:
          throw new Error(`Unexpected key: ${key}`);
      }
    }),
  } as unknown as ConfigService;
}

const VALID_JSON = JSON.stringify({
  project_id: 'eduleno-test',
  client_email: 'sa@eduleno-test.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\\nMIIEv\\n-----END PRIVATE KEY-----\\n',
});

describe('FirebaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAppsMock.mockReturnValue([]);
  });

  it('inicializa o app com a chave de servico normalizada', () => {
    new FirebaseService(configWith(VALID_JSON));

    expect(certMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'eduleno-test',
        clientEmail: 'sa@eduleno-test.iam.gserviceaccount.com',
        privateKey: PEM,
      }),
    );
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });

  it('nao inicializa duas vezes quando o processo e reaproveitado', () => {
    // A function serverless da Vercel reaproveita o processo entre invocacoes.
    // Uma segunda initializeApp estoura, entao o app existente e reutilizado.
    getAppsMock.mockReturnValue([{ name: 'existente' }]);

    new FirebaseService(configWith(VALID_JSON));

    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(getAppMock).toHaveBeenCalled();
  });

  it('configura o Firestore com preferRest', () => {
    // gRPC em function serverless pendura a primeira requisicao depois de um
    // periodo ocioso, porque a conexao nao sobrevive ao congelamento do
    // processo. preferRest usa HTTP/1.1 e contorna isso.
    new FirebaseService(configWith(VALID_JSON));

    expect(initializeFirestoreMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preferRest: true }),
    );
  });

  it('derruba o boot quando o JSON da chave nao parseia', () => {
    expect(() => new FirebaseService(configWith('{ quebrado'))).toThrow(
      /nao e um JSON valido/,
    );
  });

  it('expoe a Web API Key para as chamadas REST do Identity Toolkit', () => {
    const service = new FirebaseService(configWith(VALID_JSON));

    expect(service.webApiKey).toBe('web-api-key');
  });

  it('expoe auth e firestore', () => {
    const service = new FirebaseService(configWith(VALID_JSON));

    expect(service.auth).toBeDefined();
    expect(service.firestore).toBeDefined();
  });
});
