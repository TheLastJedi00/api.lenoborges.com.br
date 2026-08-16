import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, getApp, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import {
  initializeFirestore,
  getFirestore,
  Firestore,
} from 'firebase-admin/firestore';
import { parseServiceAccount } from '../config/service-account';

/** Base da REST do Identity Toolkit: login, envio de e-mail e reset de senha. */
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';

/** Base da API que troca refresh token por ID token novo. */
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1';

@Injectable()
export class FirebaseService {
  private readonly app: App;
  readonly auth: Auth;
  readonly firestore: Firestore;

  /**
   * Chave publica do projeto. NAO e segredo: ela vai no bundle de qualquer app
   * Firebase web por desenho, identifica o projeto e nao autoriza nada sozinha.
   * Esta no ambiente por conveniencia de configuracao, nao por sigilo.
   */
  readonly webApiKey: string;

  constructor(private readonly configService: ConfigService) {
    const serviceAccount = parseServiceAccount(
      this.configService.getOrThrow<string>('FIREBASE_SERVICE_ACCOUNT_JSON'),
    );
    this.webApiKey = this.configService.getOrThrow<string>(
      'FIREBASE_WEB_API_KEY',
    );

    // A function serverless da Vercel reaproveita o processo entre invocacoes, e
    // uma segunda initializeApp estoura. Reutilizar o app existente e o que faz
    // o servico sobreviver ao segundo request de uma mesma instancia.
    if (getApps().length === 0) {
      this.app = initializeApp({
        credential: cert({
          projectId: serviceAccount.projectId,
          clientEmail: serviceAccount.clientEmail,
          privateKey: serviceAccount.privateKey,
        }),
        projectId: serviceAccount.projectId,
      });

      // O Firestore do Admin SDK fala gRPC por padrao, e gRPC em function
      // serverless sofre com conexao que nao sobrevive ao congelamento do
      // processo: o sintoma e a primeira requisicao depois de um periodo ocioso
      // pendurar ate dar timeout. preferRest usa HTTP/1.1 e contorna isso.
      //
      // initializeFirestore so pode ser chamado antes do primeiro getFirestore
      // do app, e por isso mora aqui dentro, junto da inicializacao.
      this.firestore = initializeFirestore(this.app, { preferRest: true });
    } else {
      this.app = getApp();
      this.firestore = getFirestore(this.app);
    }

    this.auth = getAuth(this.app);
  }

  /**
   * Chama a REST do Identity Toolkit.
   *
   * O Admin SDK nao verifica senha: nao existe signInWithPassword nele, porque o
   * Firebase espera que o cliente autentique direto com o Google. Este projeto
   * mantem a decisao da spec 005 de o front nunca falar com o provedor de auth,
   * entao a chamada acontece aqui, no servidor, com a Web API Key.
   */
  async identityToolkit<T>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.post<T>(
      `${IDENTITY_TOOLKIT}/accounts:${endpoint}?key=${this.webApiKey}`,
      body,
    );
  }

  /**
   * Troca o refresh token por um ID token novo.
   *
   * Endpoint separado do Identity Toolkit, e com convencao de nome diferente: a
   * resposta daqui vem em snake_case (id_token, refresh_token, user_id),
   * enquanto a do Identity Toolkit vem em camelCase. Trocar uma pela outra e
   * erro silencioso, que aparece so como campo undefined.
   */
  async secureToken<T>(body: Record<string, unknown>): Promise<T> {
    return this.post<T>(`${SECURE_TOKEN}/token?key=${this.webApiKey}`, body);
  }

  private async post<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const payload: unknown = await response.json();

    if (!response.ok) {
      // A mensagem do Google (EMAIL_NOT_FOUND, INVALID_LOGIN_CREDENTIALS,
      // EXPIRED_OOB_CODE) e util para quem chama decidir o que responder, mas
      // nunca deve vazar para o cliente: quem chama traduz.
      const message =
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        payload.error &&
        typeof payload.error === 'object' &&
        'message' in payload.error
          ? String((payload.error as { message: unknown }).message)
          : `HTTP ${response.status}`;

      throw new FirebaseRestError(message, response.status);
    }

    return payload as T;
  }
}

/** Erro da REST do Firebase, com o codigo do Google preservado para quem traduz. */
export class FirebaseRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FirebaseRestError';
  }
}
