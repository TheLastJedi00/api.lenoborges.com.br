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
import { GYM_QUESTION_COLLECTION } from '../src/games/gym-question.repository';
import {
  MAX_QUESTIONS_PER_DIFFICULTY,
  MIN_QUESTIONS_PER_DIFFICULTY,
} from '../src/games/games.constants';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { QuestionDto, QuestionListDto } from '../src/games/dto/question.dto';
import { ChallengeConfigDto } from '../src/games/dto/challenge-config.dto';

/**
 * A administracao do banco de questoes contra o emulador (spec 022).
 *
 * **O que so este arquivo prova:** que o `AdminGuard` cobre o controller inteiro
 * -- inclusive as rotas que um teste unitario com o guard sobrescrito nao
 * exercita. Este e o unico controller do produto em que a resposta certa
 * trafega, e uma rota que escapasse do guard publicaria o `correctIndex` do
 * banco todo.
 */
describe('Administracao de questoes (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];

  let adminToken: string;
  let memberToken: string;

  /** Uma insignia so deste arquivo, para nao brigar com o games.e2e. */
  const BADGE = 'git-github';

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

    return token;
  }

  function questao(difficulty: string, i: number) {
    return {
      difficulty,
      question: `Questao ${difficulty} numero ${i}, com mais de dez caracteres`,
      alternatives: [`${i}-a`, `${i}-b`, `${i}-c`, `${i}-d`],
      correctIndex: i % 4,
    };
  }

  function criarLote(difficulty: string, quantidade: number) {
    return request(app.getHttpServer())
      .post(`/admin/badges/${BADGE}/questions/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        questions: Array.from({ length: quantidade }, (_, i) =>
          questao(difficulty, i),
        ),
      });
  }

  async function listar(query = ''): Promise<QuestionListDto> {
    const response = await request(app.getHttpServer())
      .get(`/admin/badges/${BADGE}/questions${query}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    return response.body as QuestionListDto;
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
  }, 60_000);

  afterAll(async () => {
    const docs = await firestore
      .collection(GYM_QUESTION_COLLECTION)
      .where('badgeId', '==', BADGE)
      .get();
    for (const doc of docs.docs) {
      await doc.ref.delete();
    }
    await firestore.collection('challenge_configs').doc(BADGE).delete();

    for (const uid of createdUserIds) {
      await firestore.collection(PROFILE_COLLECTION).doc(uid).delete();
      await firebase.auth.deleteUser(uid);
    }

    await app.close();
  }, 60_000);

  describe('o guard cobre o controller inteiro', () => {
    it('teste-trava: membro comum toma 403 em TODAS as rotas de questoes', async () => {
      // **Este e o unico controller do produto em que o gabarito trafega.** Uma
      // rota que escapasse do guard publicaria o `correctIndex` do banco todo, e
      // o teste unitario nao pega isso -- la o guard e sobrescrito.
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${memberToken}` };

      await request(server)
        .get(`/admin/badges/${BADGE}/questions`)
        .set(auth)
        .expect(403);
      await request(server)
        .post(`/admin/badges/${BADGE}/questions`)
        .set(auth)
        .send(questao('easy', 1))
        .expect(403);
      await request(server)
        .post(`/admin/badges/${BADGE}/questions/generate`)
        .set(auth)
        .send({ prompt: 'qualquer tema aqui', difficulty: 'easy', count: 10 })
        .expect(403);
      await request(server)
        .post(`/admin/badges/${BADGE}/questions/bulk`)
        .set(auth)
        .send({ questions: [questao('easy', 1)] })
        .expect(403);
      await request(server)
        .get(`/admin/badges/${BADGE}/challenge-config`)
        .set(auth)
        .expect(403);
      await request(server)
        .put(`/admin/badges/${BADGE}/challenge-config`)
        .set(auth)
        .send({ requiredXp: 0 })
        .expect(403);
    }, 60_000);
  });

  describe('o CRUD', () => {
    let criadaId: string;

    it('cria uma questao e devolve o correctIndex', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/badges/${BADGE}/questions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(questao('easy', 0))
        .expect(201);

      const criada = response.body as QuestionDto;
      criadaId = criada.id;

      expect(criada.badgeId).toBe(BADGE);
      expect(criada.correctIndex).toBe(0);
    });

    it('a listagem traz a contagem por nivel no mesmo corpo', async () => {
      const lista = await listar();

      expect(lista.counts.easy).toBe(1);
      expect(lista.counts.total).toBe(1);
      expect(lista.counts.ready).toBe(false);
    });

    it('filtra por dificuldade', async () => {
      await expect(listar('?difficulty=hard')).resolves.toMatchObject({
        questions: [],
      });
    });

    it('edita, e a alternativa certa acompanha a lista nova', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/badges/${BADGE}/questions/${criadaId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          alternatives: ['nova-a', 'nova-b', 'nova-c', 'nova-d'],
          correctIndex: 2,
        })
        .expect(200);

      expect((response.body as QuestionDto).correctIndex).toBe(2);
    });

    it('teste-trava: 404 ao editar pelo caminho de outra insignia', async () => {
      // O `badgeId` esta na URL. Sem a conferencia, um id colado no lugar errado
      // editaria a questao de outra insignia com 200.
      await request(app.getHttpServer())
        .patch(`/admin/badges/poo/questions/${criadaId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ correctIndex: 1 })
        .expect(404);
    });

    it('recusa questao com tres alternativas', async () => {
      await request(app.getHttpServer())
        .post(`/admin/badges/${BADGE}/questions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          difficulty: 'easy',
          question: 'Enunciado com mais de dez caracteres',
          alternatives: ['a', 'b', 'c'],
          correctIndex: 0,
        })
        .expect(400);
    });

    it('recusa correctIndex fora de 0-3', async () => {
      await request(app.getHttpServer())
        .post(`/admin/badges/${BADGE}/questions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...questao('easy', 1), correctIndex: 7 })
        .expect(400);
    });

    it('teste-trava: o bulk valida o CONTEUDO, e nao so o array', async () => {
      // Sem `@ValidateNested` com `@Type`, um array de `{}` passaria e gravaria
      // documentos vazios que so aparecem quando alguem tenta jogar.
      await request(app.getHttpServer())
        .post(`/admin/badges/${BADGE}/questions/bulk`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ questions: [{}] })
        .expect(400);
    });

    it('remove e responde 204, e a segunda vez e 404', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/badges/${BADGE}/questions/${criadaId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/admin/badges/${BADGE}/questions/${criadaId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('insignia sem GYM Challenge responde 404', async () => {
      await request(app.getHttpServer())
        .get('/admin/badges/final-gcp/questions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('o teto e o ready', () => {
    it('grava trinta de cada nivel e o ready vira true', async () => {
      for (const difficulty of ['easy', 'medium', 'hard']) {
        await criarLote(difficulty, MIN_QUESTIONS_PER_DIFFICULTY).expect(201);
      }

      const lista = await listar();

      expect(lista.counts.total).toBe(MIN_QUESTIONS_PER_DIFFICULTY * 3);
      expect(lista.counts.ready).toBe(true);
    }, 120_000);

    it('teste-trava: o lote que estoura o teto e recusado INTEIRO', async () => {
      // Gravar as que cabem deixaria o admin com um rascunho parcialmente salvo
      // e nenhuma forma de saber quais entraram -- e o rascunho ja foi perdido
      // do lado dele, porque ele nao mora em lugar nenhum.
      const antes = (await listar()).counts.easy;
      const sobra = MAX_QUESTIONS_PER_DIFFICULTY - antes;

      await criarLote('easy', sobra + 5).expect(409);

      const depois = await listar();
      expect(depois.counts.easy).toBe(antes);
    }, 60_000);
  });

  describe('a configuracao do desafio', () => {
    it('nasce com requiredXp zero e configured falso', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/badges/${BADGE}/challenge-config`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const config = response.body as ChallengeConfigDto;

      expect(config.requiredXp).toBe(0);
      expect(config.configured).toBe(false);
      // A contagem vem junto: e o cabecalho da tela, e uma segunda rota seria a
      // mesma leitura duas vezes a cada abertura.
      expect(config.counts.ready).toBe(true);
    });

    it('salva, e salvar de novo e a operacao normal', async () => {
      await request(app.getHttpServer())
        .put(`/admin/badges/${BADGE}/challenge-config`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiredXp: 200 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .put(`/admin/badges/${BADGE}/challenge-config`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiredXp: 350 })
        .expect(200);

      const config = response.body as ChallengeConfigDto;

      expect(config.requiredXp).toBe(350);
      expect(config.configured).toBe(true);
    });

    it('recusa XP negativo', async () => {
      await request(app.getHttpServer())
        .put(`/admin/badges/${BADGE}/challenge-config`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiredXp: -1 })
        .expect(400);
    });
  });
});
