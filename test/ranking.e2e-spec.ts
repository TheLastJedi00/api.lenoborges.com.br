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
import { RANKING_COLLECTION } from '../src/games/ranking.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { RankingPageDto } from '../src/games/dto/ranking.dto';

/**
 * O Ranking contra o emulador (spec 022, decisoes 11 e 22).
 *
 * **O que so este arquivo prova:** que a paginacao por cursor nao pula nem
 * repete linha com XP empatado. O teste unitario prova isso contra o Firestore
 * em memoria; aqui o `startAfter` de dois valores passa pelo banco de verdade --
 * e e no banco de verdade que a falta do desempate por `uid` se manifesta.
 *
 * O emulador **nao exige indice composto**, entao este arquivo fica verde mesmo
 * sem o `xp DESC + uid ASC` publicado. Quem garante o indice e o deploy do
 * `firestore.indexes.json`, nos dois projetos.
 */
describe('Ranking (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const seededUids: string[] = [];

  let memberToken: string;
  let memberUid: string;

  const uniqueEmail = () =>
    `e2e-rank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createSession(): Promise<{ token: string; uid: string }> {
    const email = uniqueEmail();
    const password = 'MinhaSenhaSegura123';

    const user = await firebase.auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const token = (response.body as SessionResponseDto).accessToken;
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    await firestore.collection(PROFILE_COLLECTION).doc(user.uid).set({
      name: 'Membro e2e',
      phone: '47999990000',
      bio: 'bio',
      grade: 0,
      tier: 'dev-tier',
      linkedin: null,
      instagram: null,
      emailOptOut: false,
      emailOptOutReason: null,
      emailOptOutAt: null,
      legalAcceptances: {},
      xp: 0,
      socialLinksPublic: false,
      nickname: null,
      completedAt: new Date(),
      waitlistEntryId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { token, uid: user.uid };
  }

  /** Semeia uma linha do placar direto no banco, sem passar pelo jogo. */
  async function semear(
    sufixo: string,
    xp: number,
    posicoes?: { current: number; previous: number },
  ): Promise<string> {
    const uid = `e2e-rank-${sufixo}`;
    seededUids.push(uid);

    await firestore
      .collection(RANKING_COLLECTION)
      .doc(uid)
      .set({
        uid,
        nickname: `Gamer_${sufixo}`,
        xp,
        badgeCount: 0,
        previousPosition: posicoes?.previous ?? null,
        currentPosition: posicoes?.current ?? null,
        positionUpdatedAt: posicoes ? new Date() : null,
        updatedAt: new Date(),
      });

    return uid;
  }

  async function pagina(query = ''): Promise<RankingPageDto> {
    const response = await request(app.getHttpServer())
      .get(`/ranking${query}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    return response.body as RankingPageDto;
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

    const membro = await createSession();
    memberToken = membro.token;
    memberUid = membro.uid;
  }, 60_000);

  afterAll(async () => {
    for (const uid of [...seededUids, ...createdUserIds]) {
      await firestore.collection(RANKING_COLLECTION).doc(uid).delete();
    }
    for (const uid of createdUserIds) {
      await firestore.collection(PROFILE_COLLECTION).doc(uid).delete();
      await firebase.auth.deleteUser(uid);
    }

    await app.close();
  }, 60_000);

  describe('quem nao tem gamertag', () => {
    it('ve a lista, e nao ve a propria posicao', async () => {
      await semear('solo', 999);

      const resposta = await pagina();

      expect(resposta.entries.length).toBeGreaterThan(0);
      expect(resposta.myPosition).toBeNull();
      expect(resposta.myEntry).toBeNull();
    });
  });

  describe('a ordenacao e a paginacao', () => {
    beforeAll(async () => {
      // Quatro empatados em 500 e um em 100. **O empate e o ponto**: e ele que
      // exige o desempate por `uid` no cursor.
      await semear('a', 500);
      await semear('b', 500);
      await semear('c', 500);
      await semear('d', 500);
      await semear('e', 100);
      await semear('solo', 999);
    }, 60_000);

    it('ordena por XP decrescente', async () => {
      const resposta = await pagina('?limit=50');
      const xps = resposta.entries.map((entry) => entry.xp);

      expect([...xps].sort((x, y) => y - x)).toEqual(xps);
    });

    it('numera a partir de 1, sem repetir posicao', async () => {
      const resposta = await pagina('?limit=50');
      const posicoes = resposta.entries.map((entry) => entry.position);

      expect(posicoes[0]).toBe(1);
      expect(new Set(posicoes).size).toBe(posicoes.length);
    });

    it('teste-trava: paginar de dois em dois nao pula nem repete', async () => {
      // **O defeito que este teste impede** e um placar que perde alguem no meio
      // da rolagem, sem erro e com 200. Sem o desempate por `uid`, o
      // `startAfter(500)` nao sabe qual dos quatro empatados foi o ultimo.
      const vistos: string[] = [];
      let cursor: string | null = null;

      for (let i = 0; i < 20; i += 1) {
        const query: string = cursor
          ? `?limit=2&after=${encodeURIComponent(cursor)}`
          : '?limit=2';
        const resposta: RankingPageDto = await pagina(query);

        vistos.push(...resposta.entries.map((entry) => entry.uid));
        cursor = resposta.nextCursor;

        if (cursor === null) {
          break;
        }
      }

      expect(new Set(vistos).size).toBe(vistos.length);
      expect(vistos.length).toBeGreaterThanOrEqual(6);
    }, 60_000);

    it('teste-trava: o nextCursor e null no fim, e nao um cursor vazio', async () => {
      const resposta = await pagina('?limit=50');

      expect(resposta.nextCursor).toBeNull();
    });

    it('cursor quebrado responde 400', async () => {
      await request(app.getHttpServer())
        .get('/ranking?after=bWFsLWZvcm1hZG8')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(400);
    });
  });

  describe('a posicao do membro logado', () => {
    it('aparece mesmo quando ele esta fora da pagina', async () => {
      // Ele entra no placar ao escolher a gamertag, com XP zero -- ou seja, no
      // fim da lista. A primeira pagina de dois nao o contem.
      const nickname = `Gamer${Date.now().toString(36)}`;

      await request(app.getHttpServer())
        .put('/me/nickname')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ nickname })
        .expect(204);

      const resposta = await pagina('?limit=2');

      expect(resposta.entries).toHaveLength(2);
      expect(resposta.entries.some((entry) => entry.uid === memberUid)).toBe(
        false,
      );
      expect(resposta.myPosition).not.toBeNull();
      expect(resposta.myEntry!.nickname).toBe(nickname);
    });
  });

  describe('o selo de evolucao', () => {
    it('e null para quem nunca teve posicao', async () => {
      // "Ainda nao sei" e diferente de "nao mudou". A tela nao desenha selo.
      const resposta = await pagina('?limit=50');
      const semPosicao = resposta.entries.find(
        (entry) => entry.uid === memberUid,
      );

      expect(semPosicao!.positionChange).toBeNull();
    });

    it('e previousPosition menos currentPosition para quem ja teve', async () => {
      await semear('subiu', 700, { current: 3, previous: 7 });

      const resposta = await pagina('?limit=50');
      const linha = resposta.entries.find(
        (entry) => entry.uid === 'e2e-rank-subiu',
      );

      expect(linha!.positionChange).toBe(4);
    });
  });
});
