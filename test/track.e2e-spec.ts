import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { BADGE_VIDEO_COLLECTION } from '../src/track/badge-video.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { BadgeVideoListDto } from '../src/track/dto/badge-video.dto';

describe('Trilha (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdVideoIds: string[] = [];

  let adminToken: string;
  let memberToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  /** Cria um usuário no Auth, opcionalmente admin, e devolve o access token. */
  async function createSession(isAdmin: boolean): Promise<string> {
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

    return (response.body as SessionResponseDto).accessToken;
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

    adminToken = await createSession(true);
    memberToken = await createSession(false);
  });

  afterAll(async () => {
    for (const videoId of createdVideoIds) {
      try {
        await firestore
          .collection(BADGE_VIDEO_COLLECTION)
          .doc(videoId)
          .delete();
      } catch {
        // ignore cleanup error
      }
    }
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

  it('GET /badges/:badgeId/videos sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/badges/logica/videos').expect(401);
  });

  /**
   * Insígnia vazia é o estado normal do produto: no lançamento, onze das treze
   * estarão assim. Se isto virasse 404, o front trataria conteúdo em preparo
   * como falha de rede.
   */
  it('insígnia sem vídeo responde 200 com lista vazia', async () => {
    const response = await request(app.getHttpServer())
      .get('/badges/frontier-ia/videos')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(response.body).toEqual({ badgeId: 'frontier-ia', videos: [] });
  });

  it('insígnia inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .get('/badges/insignia-inventada/videos')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);
  });

  it('membro comum recebe 403 nas rotas de administração', async () => {
    await request(app.getHttpServer())
      .get('/admin/badges/logica/videos')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  /**
   * O ciclo inteiro numa insígnia só: criar três, reordenar, ler na ordem nova,
   * apagar o do meio e conferir que as posições fecham 0,1 **sem buraco** — que
   * é o caso que ninguém lembra de testar.
   */
  it('ciclo completo: criar, reordenar, apagar o do meio e fechar a ordem', async () => {
    const badgeId = 'js-ts';
    const videos = [
      { title: 'Primeiro vídeo', youtubeUrl: 'https://youtu.be/aaaaaaaaaaa' },
      {
        title: 'Segundo vídeo',
        youtubeUrl: 'https://www.youtube.com/watch?v=bbbbbbbbbbb&t=10s',
      },
      { title: 'Terceiro vídeo', youtubeUrl: 'ccccccccccc' },
    ];

    const ids: string[] = [];
    for (const video of videos) {
      const created = await request(app.getHttpServer())
        .post(`/admin/badges/${badgeId}/videos`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(video)
        .expect(201);

      const id = (created.body as { id: string }).id;
      ids.push(id);
      createdVideoIds.push(id);
    }

    // O mesmo vídeo não entra duas vezes na mesma insígnia: a garantia é o
    // caminho do documento, e o create() recusa com ALREADY_EXISTS.
    await request(app.getHttpServer())
      .post(`/admin/badges/${badgeId}/videos`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Repetido', youtubeUrl: 'https://youtu.be/aaaaaaaaaaa' })
      .expect(409);

    // Reordenar de trás para frente.
    await request(app.getHttpServer())
      .patch(`/admin/badges/${badgeId}/videos/order`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ videoIds: [ids[2], ids[0], ids[1]] })
      .expect(204);

    const reordered = await request(app.getHttpServer())
      .get(`/badges/${badgeId}/videos`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(
      (reordered.body as BadgeVideoListDto).videos.map((video) => video.id),
    ).toEqual([ids[2], ids[0], ids[1]]);

    // Reordenar com um id faltando não pode passar: reordenar nunca apaga.
    await request(app.getHttpServer())
      .patch(`/admin/badges/${badgeId}/videos/order`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ videoIds: [ids[0], ids[1]] })
      .expect(400);

    // Apagar o do meio da ordem atual (ids[0]) e conferir que sobra 0,1.
    await request(app.getHttpServer())
      .delete(`/admin/badges/${badgeId}/videos/${ids[0]}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const afterDelete = await request(app.getHttpServer())
      .get(`/badges/${badgeId}/videos`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    const remaining = (afterDelete.body as BadgeVideoListDto).videos;
    expect(remaining.map((video) => video.id)).toEqual([ids[2], ids[1]]);
    expect(remaining.map((video) => video.order)).toEqual([0, 1]);
  });

  it('recusa link que não é do YouTube', async () => {
    await request(app.getHttpServer())
      .post('/admin/badges/logica/videos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Um título válido', youtubeUrl: 'https://vimeo.com/1' })
      .expect(400);
  });
});
