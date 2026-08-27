import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { acceptCurrentLegalDocuments } from './accept-legal.helper';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { TierCatalogDto } from '../src/billing/dto/tier-catalog.dto';

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;
  const createdUserIds: string[] = [];

  const uniqueEmail = () =>
    `e2e-billing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    firebase = app.get(FirebaseService);
    firestore = firebase.firestore;
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await firebase.auth.deleteUser(userId);
      } catch {
        // ignore cleanup error
      }
      try {
        await firestore.collection(PROFILE_COLLECTION).doc(userId).delete();
      } catch {
        // ignore profile cleanup error
      }
    }
    await app.close();
  });

  /**
   * **Este é o teste mais importante da fase.**
   *
   * O objetivo inteiro da spec 009 é o preço não estar acessível sem conta. Se
   * alguém abrir esta rota "para facilitar o desenvolvimento", é aqui que o
   * projeto avisa — e é a única barreira automática que existe contra isso.
   */
  it('GET /billing/tiers sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/billing/tiers').expect(401);
  });

  it('GET /billing/tiers com sessão devolve os quatro tiers com preço', async () => {
    const email = uniqueEmail();
    const password = 'MinhaSenhaSegura123';

    const user = await firebase.auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const session = loginRes.body as SessionResponseDto;

    // Sem isto a requisicao seguinte responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), session.accessToken);

    const response = await request(app.getHttpServer())
      .get('/billing/tiers')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    const catalog = response.body as TierCatalogDto;

    expect(catalog.tiers.map((tier) => tier.id)).toEqual([
      'dev-tier',
      'great-dev-tier',
      'ultra-dev-tier',
      'master-dev-tier',
    ]);

    // Centavos, não decimal. O Master é o tier novo da spec 009, e o valor está
    // fixado aqui de propósito: mudar o preço tem que ser um ato consciente.
    const master = catalog.tiers.find((tier) => tier.id === 'master-dev-tier');
    expect(master?.price).toBe(26000);

    // Enquanto não existe cobrança, todo mundo é Dev Tier — e a resposta sai de
    // resolveCurrentTier, num lugar só.
    expect(catalog.currentTierId).toBe('dev-tier');
  });

  // A sessão carrega o papel para o front decidir se desenha a Administração.
  // Quem impede o acesso continua sendo o AdminGuard.
  it('a sessão de um membro comum carrega role nulo', async () => {
    const email = uniqueEmail();
    const password = 'MinhaSenhaSegura123';

    const user = await firebase.auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    expect((loginRes.body as SessionResponseDto).role).toBeNull();
  });
});
