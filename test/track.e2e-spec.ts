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
import { BADGE_VIDEO_COLLECTION } from '../src/track/badge-video.repository';
import { MURAL_COLLECTION } from '../src/mural/mural.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import {
  BadgeVideoDto,
  BadgeVideoListDto,
} from '../src/track/dto/badge-video.dto';
import { MuralQuestionDto } from '../src/mural/dto/mural-question.dto';

describe('Trilha (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdVideoIds: string[] = [];
  const createdQuestionIds: string[] = [];

  let adminToken: string;
  let memberToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  /**
   * Cria um membro comum e devolve token **e uid**.
   *
   * A spec 017 precisa do uid porque uma pergunta é uma por membro por semana:
   * cada pergunta do teste exige um autor novo, e reusar o `memberToken` daria
   * 409 na segunda.
   */
  async function createSessionComUid(): Promise<{
    token: string;
    uid: string;
  }> {
    const email = uniqueEmail('autor');
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
    // Sem isto a proxima requisicao desta sessao responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    return {
      token,
      uid: user.uid,
    };
  }

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

    const token = (response.body as SessionResponseDto).accessToken;
    // Sem isto a proxima requisicao desta sessao responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    return token;
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
    for (const questionId of createdQuestionIds) {
      try {
        await firestore.collection(MURAL_COLLECTION).doc(questionId).delete();
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

  describe('vídeos de resposta (spec 017)', () => {
    /**
     * Cria uma pergunta de verdade no Mural, com um autor de verdade.
     *
     * A pergunta vem pela API e não plantada à mão porque é dela que sai a foto
     * — `authorName` inclusive —, e um documento montado no teste poderia
     * divergir do que o produto grava.
     */
    async function perguntar(badgeId: string, title: string) {
      const { token, uid } = await createSessionComUid();
      const criada = await request(app.getHttpServer())
        .post('/mural/perguntas')
        .set('Authorization', `Bearer ${token}`)
        .send({ badgeId, title })
        .expect(201);

      const question = criada.body as MuralQuestionDto;
      createdQuestionIds.push(question.id);

      return { question, uid };
    }

    /**
     * **O caminho inteiro da spec 017, numa prova só.**
     *
     * Do link de Shorts colado pelo admin até o balão que o aluno vê, passando
     * pelas quatro consequências que nenhuma outra prova junta: o ID sai certo
     * de uma URL que era 400 até esta spec, o vídeo sai em retrato, ele carrega
     * a foto da pergunta, e a pergunta ficou apontando de volta para ele.
     */
    it('publica um Short como resposta e devolve retrato, foto e vínculo', async () => {
      const { question } = await perguntar(
        'poo',
        'Quando usar herança em vez de composição?',
      );

      const criado = await request(app.getHttpServer())
        .post('/admin/badges/poo/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Herança e composição, na prática',
          // A forma que o botão Compartilhar do YouTube copia num celular, e
          // que respondia 400 até a Fase 01 desta spec.
          youtubeUrl:
            'https://www.youtube.com/shorts/rrrrrrrrrrr?feature=share',
          kind: 'resposta',
          questionId: question.id,
        })
        .expect(201);

      const video = criado.body as BadgeVideoDto;
      createdVideoIds.push(video.id);

      // 1. O ID saiu da URL de Shorts, e o caminho do documento é o de sempre.
      expect(video.youtubeId).toBe('rrrrrrrrrrr');
      expect(video.id).toBe('poo__rrrrrrrrrrr');

      // 2. A orientação é derivada, e a tela não precisa saber por quê.
      expect(video.orientation).toBe('retrato');

      // 3. A foto veio junto, com a data da PERGUNTA.
      expect(video.question?.id).toBe(question.id);
      expect(video.question?.title).toBe(
        'Quando usar herança em vez de composição?',
      );
      expect(video.question?.authorName).toBe(question.authorName);
      expect(typeof video.question?.askedAt).toBe('string');

      // 4. O vínculo fechou do outro lado — o campo que existia desde a spec
      // 010 e que nada nunca escrevia.
      const doMural = await firestore
        .collection(MURAL_COLLECTION)
        .doc(question.id)
        .get();

      expect(doMural.data()?.answerVideoId).toBe(video.id);

      // E o aluno recebe tudo isso na listagem pública, sem leitura extra.
      const naTrilha = await request(app.getHttpServer())
        .get('/badges/poo/videos?kind=resposta')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      const listado = (naTrilha.body as BadgeVideoListDto).videos.find(
        (item) => item.id === video.id,
      );

      expect(listado?.orientation).toBe('retrato');
      expect(listado?.question?.title).toBe(
        'Quando usar herança em vez de composição?',
      );
    });

    it('a aula continua saindo em paisagem e sem balão', async () => {
      const criado = await request(app.getHttpServer())
        .post('/admin/badges/poo/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Uma aula comum',
          youtubeUrl: 'https://youtu.be/ppppppppppp',
        })
        .expect(201);

      const video = criado.body as BadgeVideoDto;
      createdVideoIds.push(video.id);

      expect(video.orientation).toBe('paisagem');
      expect(video.question).toBeNull();
    });

    /**
     * As três recusas juntas, porque as três são a mesma simetria (decisão 4):
     * aula com pergunta e resposta sem pergunta são os dois estados incoerentes,
     * e uma pergunta que não existe é a terceira forma de chegar num vídeo com
     * balão vazio.
     */
    it('recusa resposta sem pergunta, pergunta inexistente e aula com pergunta', async () => {
      await request(app.getHttpServer())
        .post('/admin/badges/poo/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Uma resposta órfã',
          youtubeUrl: 'https://youtu.be/qqqqqqqqqqq',
          kind: 'resposta',
        })
        .expect(400);

      await request(app.getHttpServer())
        .post('/admin/badges/poo/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Respondendo o vento',
          youtubeUrl: 'https://youtu.be/qqqqqqqqqqq',
          kind: 'resposta',
          questionId: '2020-01-05__ninguem',
        })
        .expect(404);

      await request(app.getHttpServer())
        .post('/admin/badges/poo/videos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Uma aula com pergunta',
          youtubeUrl: 'https://youtu.be/qqqqqqqqqqq',
          kind: 'aula',
          questionId: '2020-01-05__ninguem',
        })
        .expect(400);
    });

    /**
     * **As duas abas não se misturam no painel.**
     *
     * Sem o `?kind=` que esta spec deu ao `GET` do admin, a tela lista as duas
     * juntas e manda essa lista para uma reordenação que valida contra **uma**
     * aba — 400 em toda seta clicada, a partir da primeira resposta publicada.
     */
    it('o painel lista e reordena uma aba por vez', async () => {
      const badgeId = 'banco-de-dados';
      const { question } = await perguntar(badgeId, 'Índice serve para quê?');

      const ids: Record<string, string> = {};
      const publicar = async (
        chave: string,
        youtubeUrl: string,
        resposta: boolean,
      ) => {
        const criado = await request(app.getHttpServer())
          .post(`/admin/badges/${badgeId}/videos`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            title: `Vídeo ${chave}`,
            youtubeUrl,
            ...(resposta ? { kind: 'resposta', questionId: question.id } : {}),
          })
          .expect(201);

        const video = criado.body as BadgeVideoDto;
        ids[chave] = video.id;
        createdVideoIds.push(video.id);
      };

      await publicar('aula1', 'https://youtu.be/ddddddddddd', false);
      await publicar('aula2', 'https://youtu.be/eeeeeeeeeee', false);
      await publicar(
        'resp1',
        'https://www.youtube.com/shorts/fffffffffff',
        true,
      );
      await publicar(
        'resp2',
        'https://www.youtube.com/shorts/ggggggggggg',
        true,
      );

      const respostas = await request(app.getHttpServer())
        .get(`/admin/badges/${badgeId}/videos?kind=resposta`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        (respostas.body as BadgeVideoListDto).videos.map((item) => item.id),
      ).toEqual([ids.resp1, ids.resp2]);

      // Reordenar as respostas: a lista bate com a aba, então passa.
      await request(app.getHttpServer())
        .patch(`/admin/badges/${badgeId}/videos/order?kind=resposta`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ videoIds: [ids.resp2, ids.resp1] })
        .expect(204);

      // E as aulas não se mexeram: a renormalização é dentro da aba.
      const aulas = await request(app.getHttpServer())
        .get(`/admin/badges/${badgeId}/videos?kind=aula`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const listaDeAulas = (aulas.body as BadgeVideoListDto).videos;
      expect(listaDeAulas.map((item) => item.id)).toEqual([
        ids.aula1,
        ids.aula2,
      ]);
      expect(listaDeAulas.map((item) => item.order)).toEqual([0, 1]);
    });
  });
});
