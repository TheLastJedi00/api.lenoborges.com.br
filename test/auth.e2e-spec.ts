import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/auth/supabase.service';
import { DataSource } from 'typeorm';
import { Profile } from '../src/profile/entities/profile.entity';
import { REFRESH_TOKEN_COOKIE_NAME } from '../src/auth/cookie.service';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';

describe('Auth & Profile (e2e)', () => {
  let app: INestApplication<App>;
  let supabaseService: SupabaseService;
  let dataSource: DataSource;
  const createdUserIds: string[] = [];

  const uniqueEmail = () =>
    `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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
    supabaseService = app.get(SupabaseService);
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await supabaseService.adminClient.auth.admin.deleteUser(userId);
      } catch {
        // ignore cleanup error
      }
      try {
        if (dataSource?.isInitialized) {
          await dataSource.getRepository(Profile).delete({ id: userId });
        }
      } catch {
        // ignore profile cleanup error
      }
    }
    await app.close();
  });

  it('POST /auth/signup válido responde 202 com status confirmation_sent', async () => {
    const email = uniqueEmail();

    const response = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        emailConfirmation: email,
      })
      .expect(202);

    expect(response.body).toEqual({ status: 'confirmation_sent' });
  });

  it('POST /auth/signup com e-mails divergentes responde 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: 'user1@test.com',
        emailConfirmation: 'user2@test.com',
      })
      .expect(400);
  });

  it('POST /auth/login com credencial errada responde 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'inexistente@test.com',
        password: 'senha-incorreta-123',
      })
      .expect(401);
  });

  it('GET /me sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('Ciclo completo: login -> cookie HttpOnly -> GET /me -> PATCH /me/profile -> refresh -> logout', async () => {
    const testEmail = uniqueEmail();
    const testPassword = 'MinhaSenhaSegura123';

    // 1. Criar usuario confirmado via admin para o teste de ciclo
    const { data: userData, error: userError } =
      await supabaseService.adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });

    expect(userError).toBeNull();
    expect(userData.user?.id).toBeDefined();
    const userId = userData.user!.id;
    createdUserIds.push(userId);

    // 2. Login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: testEmail,
        password: testPassword,
      })
      .expect(200);

    const sessionData = loginRes.body as SessionResponseDto;
    expect(sessionData).toHaveProperty('accessToken');
    expect(sessionData).toHaveProperty('expiresIn');
    expect(sessionData.user).toEqual({
      id: userId,
      email: testEmail,
    });
    expect(sessionData.profileCompleted).toBe(false);
    expect(sessionData.grade).toBe(1);

    const cookies = loginRes.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const rtCookie = cookies.find((c) =>
      c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
    );
    expect(rtCookie).toBeDefined();
    expect(rtCookie).toContain('HttpOnly');

    const accessToken = sessionData.accessToken;

    // 3. GET /me com access token
    const meRes = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const profileData = meRes.body as ProfileDto;
    expect(profileData.id).toBe(userId);
    expect(profileData.email).toBe(testEmail);
    expect(profileData.profileCompleted).toBe(false);

    // 4. PATCH /me/profile
    const patchRes = await request(app.getHttpServer())
      .patch('/me/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: '  Leno   Borges  ',
        phone: '(47) 99999-0000',
        bio: '  Desenvolvedor full-stack focado em boas práticas.  ',
      })
      .expect(200);

    const updatedProfile = patchRes.body as ProfileDto;
    expect(updatedProfile.name).toBe('Leno Borges');
    expect(updatedProfile.phone).toBe('47999990000');
    expect(updatedProfile.bio).toBe(
      'Desenvolvedor full-stack focado em boas práticas.',
    );
    expect(updatedProfile.profileCompleted).toBe(true);
    expect(updatedProfile.grade).toBe(1);

    // 5. GET /me reflete o perfil atualizado
    const meUpdatedRes = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const reloadedProfile = meUpdatedRes.body as ProfileDto;
    expect(reloadedProfile.profileCompleted).toBe(true);
    expect(reloadedProfile.name).toBe('Leno Borges');

    // 6. POST /auth/refresh com o cookie
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', rtCookie!)
      .expect(200);

    const refreshedData = refreshRes.body as SessionResponseDto;
    expect(refreshedData).toHaveProperty('accessToken');
    expect(refreshedData.profileCompleted).toBe(true);

    const newCookies = refreshRes.headers['set-cookie'] as unknown as string[];
    const newRtCookie = newCookies.find((c) =>
      c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`),
    );
    expect(newRtCookie).toBeDefined();

    // 7. POST /auth/logout
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', newRtCookie!)
      .expect(204);
  });
});
