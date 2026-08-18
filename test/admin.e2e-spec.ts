import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { AdminUserPageDto } from '../src/admin/dto/admin-user-page.dto';

describe('Administração de usuários (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  let adminToken: string;
  let memberToken: string;
  let memberId: string;
  let semPerfilId: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createSession(
    isAdmin: boolean,
  ): Promise<{ token: string; uid: string }> {
    const email = uniqueEmail(isAdmin ? 'admin' : 'membro');
    const password = 'MinhaSenhaSegura123';

    const user = await firebase.auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    if (isAdmin) {
      await firebase.auth.setCustomUserClaims(user.uid, { role: 'admin' });
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return {
      token: (response.body as SessionResponseDto).accessToken,
      uid: user.uid,
    };
  }

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

    adminToken = (await createSession(true)).token;
    const member = await createSession(false);
    memberToken = member.token;
    memberId = member.uid;

    // Um usuário que existe no Auth e NUNCA teve perfil: quem se cadastrou e
    // parou. Ele é o caso que a decisão 10 protege.
    const semPerfil = await firebase.auth.createUser({
      email: uniqueEmail('sem-perfil'),
      password: 'MinhaSenhaSegura123',
    });
    semPerfilId = semPerfil.uid;
    createdUserIds.push(semPerfilId);
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
        // ignore cleanup error
      }
    }
    await app.close();
  });

  it('membro comum recebe 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });

  it('admin lista os usuários cadastrados', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/users?limit=1000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const page = response.body as AdminUserPageDto;
    expect(page.users.some((user) => user.id === memberId)).toBe(true);
  });

  /**
   * O teste que sustenta a decisão 10: a listagem é paginada pelo Auth, então
   * quem nunca criou perfil continua visível — com os campos nulos, que é
   * informação, e não ausência de dado.
   */
  it('usuário sem perfil aparece com os campos de perfil nulos', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/users?limit=1000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const page = response.body as AdminUserPageDto;
    const semPerfil = page.users.find((user) => user.id === semPerfilId);

    expect(semPerfil).toBeDefined();
    expect(semPerfil).toMatchObject({
      name: null,
      grade: null,
      profileCompleted: false,
    });
  });

  it('admin altera o grade de um membro', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: 7 })
      .expect(204);

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect((me.body as { grade: number }).grade).toBe(7);
  });

  /**
   * tier nao e claim: ele vale na hora, sem esperar token novo. Este teste e o
   * que denuncia alguem transforma-lo em custom claim "por simetria com role" --
   * o membro que acabou de pagar ficaria ate uma hora sem acesso.
   */
  it('admin altera o tier, e o efeito vale na sessao atual', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/`)
      .set('Authorization', `Bearer `)
      .send({ tier: 'great-dev-tier' })
      .expect(204);

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer `)
      .expect(200);

    expect((me.body as { tier: string }).tier).toBe('great-dev-tier');
    // E o grade nao se mexeu junto.
    expect((me.body as { grade: number }).grade).toBe(7);
  });

  it('recusa tier que nao existe', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/`)
      .set('Authorization', `Bearer `)
      .send({ tier: 'plus-dev-tier' })
      .expect(400);
  });

  it('recusa grade fora da faixa 0..13', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: 33 })
      .expect(400);
  });
});
