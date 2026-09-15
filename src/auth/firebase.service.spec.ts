import { ConfigService } from '@nestjs/config';

const initializeAppMock = jest.fn(() => ({ name: 'test-app' }));
const getAppsMock = jest.fn(() => [] as unknown[]);
const getAppMock = jest.fn(() => ({ name: 'test-app' }));
const certMock = jest.fn((credential: unknown) => ({ credential }));
const getAuthMock = jest.fn(() => ({ name: 'auth' }));
const initializeFirestoreMock = jest.fn(() => ({ name: 'firestore' }));
const getFirestoreMock = jest.fn(() => ({ name: 'firestore' }));
const getStorageMock = jest.fn(() => ({ name: 'storage' }));

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

jest.mock('firebase-admin/storage', () => ({
  getStorage: (...args: unknown[]) => getStorageMock(...(args as [])),
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
        case 'FIREBASE_STORAGE_BUCKET':
          return 'eduleno-test.firebasestorage.app';
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

  it('expoe auth, firestore e storage', () => {
    const service = new FirebaseService(configWith(VALID_JSON));

    expect(service.auth).toBeDefined();
    expect(service.firestore).toBeDefined();
    expect(service.storage).toBeDefined();
  });

  // **O bucket tem que chegar ao initializeApp, e e isso que este teste trava**
  // (spec 027). Sem o storageBucket na inicializacao, o getStorage devolve um
  // servico que funciona e o `bucket()` sem argumento estoura so na primeira
  // escrita, com "Bucket name not specified" -- longe daqui, dentro da rota de
  // upload, num erro que nao fala de configuracao.
  it('passa o bucket do Storage para o initializeApp', () => {
    const service = new FirebaseService(configWith(VALID_JSON));

    expect(service.storageBucket).toBe('eduleno-test.firebasestorage.app');
    expect(initializeAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageBucket: 'eduleno-test.firebasestorage.app',
      }),
    );
  });
});
