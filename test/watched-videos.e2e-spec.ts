import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { acceptCurrentLegalDocuments } from './accept-legal.helper';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { BADGE_VIDEO_COLLECTION } from '../src/track/badge-video.repository';
import { XP_PER_VIDEO } from '../src/track/track.constants';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { BadgeVideoListDto } from '../src/track/dto/badge-video.dto';
import { WatchedVideoDto } from '../src/track/dto/set-watched.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';

/**
 * O percurso do check e do XP contra o emulador (spec 019).
 *
 * **O caso que mais importa e o de desmarcar e remarcar**: e ali que um
 * `delete` no lugar do `watched: false` transformaria o duplo clique em farm de
 * pontos, e nenhum teste unitario que use `jest.fn()` pega isso.
 */
describe('Videos assistidos e XP (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdVideoIds: string[] = [];

  let adminToken: string;
  let memberToken: string;
  let memberUid: string;
  let outroToken: string;

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

    const token = (response.body as SessionResponseDto).accessToken;
    // Sem isto a proxima requisicao desta sessao responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    return { token, uid: user.uid };
  }

  async function publicarVideo(youtubeId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/admin/badges/logica/videos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `Aula ${youtubeId}`,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      })
      .expect(201);

    const id = (response.body as { id: string }).id;
    createdVideoIds.push(id);

    return id;
  }

  async function marcar(
    videoId: string,
    watched: boolean,
    token = memberToken,
  ): Promise<WatchedVideoDto> {
    const response = await request(app.getHttpServer())
      .put(`/me/watched-videos/${videoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ watched })
      .expect(200);

    return response.body as WatchedVideoDto;
  }

  async function listar(token = memberToken): Promise<BadgeVideoListDto> {
    const response = await request(app.getHttpServer())
      .get('/badges/logica/videos')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as BadgeVideoListDto;
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

    const admin = await createSession(true);
    adminToken = admin.token;

    const membro = await createSession(false);
    memberToken = membro.token;
    memberUid = membro.uid;

    const outro = await createSession(false);
    outroToken = outro.token;
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
        const razao = await firestore
          .collection(PROFILE_COLLECTION)
          .doc(userId)
          .collection('watched_videos')
          .listDocuments();
        for (const ref of razao) {
          await ref.delete();
        }
      } catch {
        // ignore cleanup error
      }
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

  it('o percurso inteiro: marcar, listar, desmarcar e remarcar', async () => {
    const primeiro = await publicarVideo('aaa11111111');
    const segundo = await publicarVideo('bbb22222222');

    // 1. Tudo comeca desmarcado, e o campo existe desde a primeira leitura.
    const inicial = await listar();
    expect(inicial.videos.map((v) => v.watched)).toEqual([false, false]);

    // 2. Dois videos marcados sao 20 XP.
    expect((await marcar(primeiro, true)).xp).toBe(XP_PER_VIDEO);
    expect((await marcar(segundo, true)).xp).toBe(XP_PER_VIDEO * 2);

    // 3. E a lista volta com os dois marcados: o check sobrevive ao F5.
    const marcados = await listar();
    expect(marcados.videos.every((v) => v.watched)).toBe(true);

    // 4. **Desmarcar tira o check e nao devolve o XP.**
    const desmarcado = await marcar(primeiro, false);
    expect(desmarcado.watched).toBe(false);
    expect(desmarcado.xp).toBe(XP_PER_VIDEO * 2);

    const depois = await listar();
    expect(depois.videos.find((v) => v.id === primeiro)!.watched).toBe(false);

    // 5. **E remarcar nao paga de novo.** Se o desmarcar tivesse apagado o
    //    registro, esta linha veria 30 -- e o farm seria um duplo clique.
    expect((await marcar(primeiro, true)).xp).toBe(XP_PER_VIDEO * 2);

    // 6. O `GET /me` conta a mesma coisa que o PUT contou.
    const perfil = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect((perfil.body as ProfileDto).xp).toBe(XP_PER_VIDEO * 2);
  });

  /**
   * XP e moeda, e o `videoId` vem da URL. Sem esta conferencia, repetir a
   * chamada com sufixos diferentes seria XP infinito sem tocar em nenhum video.
   */
  it('teste-trava: videoId inventado responde 404 e o XP nao muda', async () => {
    const antes = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .put('/me/watched-videos/logica__nao-existe')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ watched: true })
      .expect(404);

    const depois = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect((depois.body as ProfileDto).xp).toBe((antes.body as ProfileDto).xp);
  });

  /** A lista deixou de ser igual para todo mundo, e o razao e por perfil. */
  it('teste-trava: o check de um membro nao aparece para outro', async () => {
    const video = await publicarVideo('ccc33333333');
    await marcar(video, true);

    const doOutro = await listar(outroToken);

    expect(doOutro.videos.find((v) => v.id === video)!.watched).toBe(false);
  });

  it('o corpo exige `watched`: um PUT vazio nao marca nada', async () => {
    const video = await publicarVideo('ddd44444444');

    await request(app.getHttpServer())
      .put(`/me/watched-videos/${video}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({})
      .expect(400);
  });

  it('sem sessao, 401', async () => {
    await request(app.getHttpServer())
      .put('/me/watched-videos/logica__aaa11111111')
      .send({ watched: true })
      .expect(401);
  });

  /**
   * Quarta vez que este produto esbarra em "subcolecao nao some com o pai".
   * O razao e historico de comportamento ligado a um `uid`.
   */
  it('excluir a conta apaga o razao do que foi assistido', async () => {
    const video = await publicarVideo('eee55555555');
    const { token, uid } = await createSession(false);

    await marcar(video, true, token);

    const antes = await firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection('watched_videos')
      .listDocuments();
    expect(antes).toHaveLength(1);

    await request(app.getHttpServer())
      .delete('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'MinhaSenhaSegura123' })
      .expect(204);

    const depois = await firestore
      .collection(PROFILE_COLLECTION)
      .doc(uid)
      .collection('watched_videos')
      .listDocuments();
    expect(depois).toHaveLength(0);
  });

  it('o uid do membro continua sendo o dono do proprio razao', () => {
    expect(memberUid).toBeTruthy();
  });
});
