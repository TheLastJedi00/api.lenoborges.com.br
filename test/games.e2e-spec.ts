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
import { GYM_CHALLENGE_COLLECTION } from '../src/games/gym-challenge.repository';
import { RANKING_COLLECTION } from '../src/games/ranking.repository';
import { NICKNAME_COLLECTION } from '../src/profile/nickname.repository';
import { MIN_QUESTIONS_PER_DIFFICULTY } from '../src/games/games.constants';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { ChallengeStateDto } from '../src/games/dto/challenge-state.dto';
import { StartRoundDto } from '../src/games/dto/round-question.dto';
import { AnswerResultDto } from '../src/games/dto/answer-question.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';

/**
 * O GYM Challenge de ponta a ponta, contra o emulador (spec 022).
 *
 * **O que so este arquivo prova:** que as tres rodadas fecham, que o `grade`
 * sobe, e que o gabarito nunca atravessa a rede. Os testes unitarios usam o
 * Firestore em memoria; aqui o embaralhamento, os dez documentos efemeros e o
 * lote que paga o XP passam pelo banco de verdade.
 *
 * O `createSession` aceita os documentos legais logo depois do login -- sem
 * isso, a proxima requisicao de qualquer suite responde `428` (spec 018).
 */
describe('GYM Challenge (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdNicknames: string[] = [];

  let adminToken: string;
  let memberToken: string;
  let memberUid: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  const uniqueNickname = () =>
    `Gamer${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    // O perfil precisa existir: o desafio le `xp` e `grade` dele.
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

  /** Cadastra 30 questoes por nivel, o minimo que liga o desafio. */
  async function popularBanco(badgeId: string): Promise<void> {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      await request(app.getHttpServer())
        .post(`/admin/badges/${badgeId}/questions/bulk`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          questions: Array.from(
            { length: MIN_QUESTIONS_PER_DIFFICULTY },
            (_, i) => ({
              difficulty,
              question: `Questao ${difficulty} numero ${i} da insignia ${badgeId}`,
              alternatives: [
                `${difficulty}-${i}-certa`,
                `${difficulty}-${i}-b`,
                `${difficulty}-${i}-c`,
                `${difficulty}-${i}-d`,
              ],
              // A certa e sempre a posicao 0 do banco -- e o embaralhamento do
              // servidor e o que faz ela cair em qualquer lugar na rodada. E
              // por isso que o teste identifica a certa pelo TEXTO, e nao pelo
              // indice: se ele soubesse o indice de antemao, nao estaria
              // provando que o embaralhamento acontece.
              correctIndex: 0,
            }),
          ),
        })
        .expect(201);
    }
  }

  async function estado(badgeId: string): Promise<ChallengeStateDto> {
    const response = await request(app.getHttpServer())
      .get(`/games/challenges/${badgeId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    return response.body as ChallengeStateDto;
  }

  async function iniciar(badgeId: string): Promise<StartRoundDto> {
    const response = await request(app.getHttpServer())
      .post(`/games/challenges/${badgeId}/start`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    return response.body as StartRoundDto;
  }

  /** Responde a rodada inteira, acertando `acertos` das dez. */
  async function jogar(
    badgeId: string,
    rodada: StartRoundDto,
    acertos = 10,
  ): Promise<AnswerResultDto> {
    let ultimo!: AnswerResultDto;

    for (const questao of rodada.questions) {
      // A certa e a que termina em `-certa`. O indice dela muda a cada rodada
      // porque o servidor embaralha.
      const certa = questao.alternatives.findIndex((texto) =>
        texto.endsWith('-certa'),
      );
      const escolha = questao.index < acertos ? certa : (certa + 1) % 4;

      const response = await request(app.getHttpServer())
        .post(`/games/challenges/${badgeId}/answer`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          questionIndex: questao.index,
          chosenIndex: escolha,
          clientElapsedMs: 1000,
        })
        .expect(200);

      ultimo = response.body as AnswerResultDto;
    }

    return ultimo;
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
  }, 60_000);

  afterAll(async () => {
    for (const collection of [
      GYM_QUESTION_COLLECTION,
      GYM_CHALLENGE_COLLECTION,
    ]) {
      const docs = await firestore.collection(collection).get();
      for (const doc of docs.docs) {
        // A subcolecao antes do pai: a regra que este produto ja esqueceu cinco
        // vezes vale tambem na limpeza do teste.
        const sub = await doc.ref.collection('active_round').listDocuments();
        for (const ref of sub) {
          await ref.delete();
        }
        await doc.ref.delete();
      }
    }

    for (const nickname of createdNicknames) {
      await firestore
        .collection(NICKNAME_COLLECTION)
        .doc(nickname.toLowerCase())
        .delete();
    }

    for (const uid of createdUserIds) {
      await firestore.collection(RANKING_COLLECTION).doc(uid).delete();
      await firestore.collection(PROFILE_COLLECTION).doc(uid).delete();
      await firebase.auth.deleteUser(uid);
    }

    await app.close();
  }, 60_000);

  describe('a gamertag', () => {
    it('nasce nula no GET /me', async () => {
      const response = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect((response.body as ProfileDto).nickname).toBeNull();
    });

    it('e gravada, e o membro entra no ranking com o XP que ja tinha', async () => {
      const nickname = uniqueNickname();
      createdNicknames.push(nickname);

      await request(app.getHttpServer())
        .put('/me/nickname')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ nickname })
        .expect(204);

      const perfil = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect((perfil.body as ProfileDto).nickname).toBe(nickname);

      const linha = await firestore
        .collection(RANKING_COLLECTION)
        .doc(memberUid)
        .get();

      expect(linha.exists).toBe(true);
      expect(linha.data()!.nickname).toBe(nickname);
    });

    it('teste-trava: escolher de novo responde 409, porque e imutavel', async () => {
      await request(app.getHttpServer())
        .put('/me/nickname')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ nickname: uniqueNickname() })
        .expect(409);
    });

    it('teste-trava: o nome de outra pessoa tambem responde 409', async () => {
      const outro = await createSession(false);
      const nickname = createdNicknames[0];

      await request(app.getHttpServer())
        .put('/me/nickname')
        .set('Authorization', `Bearer ${outro.token}`)
        // A colisao e case-insensitive: duas gamertags que se leem igual num
        // placar sao a mesma gamertag para quem esta olhando.
        .send({ nickname: nickname.toUpperCase() })
        .expect(409);
    });
  });

  describe('o desafio antes de existir', () => {
    it('a insignia sem questoes fica em "em-breve"', async () => {
      await expect(estado('poo')).resolves.toMatchObject({
        status: 'em-breve',
      });
    });

    it('e o start responde 403', async () => {
      await request(app.getHttpServer())
        .post('/games/challenges/poo/start')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('a lista traz as oito insignias, e nenhuma da Elite Four', async () => {
      const response = await request(app.getHttpServer())
        .get('/games/challenges')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      const lista = (response.body as { challenges: ChallengeStateDto[] })
        .challenges;

      expect(lista).toHaveLength(8);
      expect(lista.map((item) => item.badgeId)).not.toContain('final-gcp');
    });

    it('insignia sem GYM Challenge responde 404', async () => {
      await request(app.getHttpServer())
        .get('/games/challenges/final-gcp')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(404);
    });
  });

  describe('as tres rodadas', () => {
    beforeAll(async () => {
      await popularBanco('logica');
    }, 60_000);

    it('o desafio fica disponivel depois das 90 questoes', async () => {
      await expect(estado('logica')).resolves.toMatchObject({
        status: 'disponivel',
        currentRound: 1,
      });
    });

    it('teste-trava: as questoes chegam sem a resposta certa', async () => {
      const rodada = await iniciar('logica');

      expect(rodada.questions).toHaveLength(10);
      for (const questao of rodada.questions) {
        expect(Object.keys(questao).sort()).toEqual([
          'alternatives',
          'index',
          'question',
        ]);
      }
      expect(JSON.stringify(rodada)).not.toContain('correctIndex');
      expect(JSON.stringify(rodada)).not.toContain('correctAlternativeIndex');
    });

    it('teste-trava: as alternativas vem embaralhadas, e a certa viaja junto', async () => {
      // **Todas as questoes do banco tem a certa na posicao 0.** Se a rodada
      // servisse na ordem original, a certa estaria sempre em 0 -- e uma tela
      // atenta descobriria o padrao na primeira rodada. Aqui o teste le os dez
      // documentos gravados e afirma duas coisas: que as posicoes variam, e que
      // o `correctAlternativeIndex` gravado aponta mesmo para a alternativa que
      // termina em `-certa`.
      const docs = await firestore
        .collection(GYM_CHALLENGE_COLLECTION)
        .doc(`logica__${memberUid}`)
        .collection('active_round')
        .get();

      expect(docs.size).toBe(10);

      const posicoes = new Set<number>();

      for (const doc of docs.docs) {
        const data = doc.data();
        const alternativas = data.alternatives as string[];
        const certa = data.correctAlternativeIndex as number;

        expect(alternativas[certa]).toMatch(/-certa$/);
        posicoes.add(certa);
      }

      // Dez sorteios de quatro posicoes caindo todos no mesmo lugar tem chance
      // de 4 x (1/4)^10 -- uma em cerca de 262 mil. Um `> 1` aqui e um teste que
      // falha por acaso menos de uma vez a cada cem mil execucoes, e que falha
      // sempre no dia em que o embaralhamento sumir.
      expect(posicoes.size).toBeGreaterThan(1);
    });

    it('409 ao iniciar com uma rodada em andamento', async () => {
      await request(app.getHttpServer())
        .post('/games/challenges/logica/start')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(409);
    });

    it('reprovar mantem a rodada, e nao avanca', async () => {
      const rodada = await request(app.getHttpServer())
        .get('/games/challenges/logica')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);

      expect((rodada.body as ChallengeStateDto).currentRound).toBe(1);

      // A rodada aberta e a do teste anterior. Responde tudo errado.
      const aberta = await request(app.getHttpServer())
        .get('/games/challenges/logica')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect((aberta.body as ChallengeStateDto).hasActiveRound).toBe(true);

      const docs = await firestore
        .collection(GYM_CHALLENGE_COLLECTION)
        .doc(`logica__${memberUid}`)
        .collection('active_round')
        .get();

      let ultimo!: AnswerResultDto;
      for (const doc of docs.docs.sort((a, b) => Number(a.id) - Number(b.id))) {
        const certa = doc.data().correctAlternativeIndex as number;
        const response = await request(app.getHttpServer())
          .post('/games/challenges/logica/answer')
          .set('Authorization', `Bearer ${memberToken}`)
          .send({
            questionIndex: Number(doc.id),
            chosenIndex: (certa + 1) % 4,
            clientElapsedMs: 1000,
          })
          .expect(200);
        ultimo = response.body as AnswerResultDto;
      }

      expect(ultimo.roundComplete).toBe(true);
      expect(ultimo.score).toBe(0);
      expect(ultimo.roundPassed).toBe(false);

      await expect(estado('logica')).resolves.toMatchObject({
        currentRound: 1,
      });
    }, 60_000);

    it('acertar dez fecha as tres rodadas e conquista a insignia', async () => {
      let ultimo!: AnswerResultDto;

      for (let rodada = 1; rodada <= 3; rodada += 1) {
        const aberta = await iniciar('logica');
        expect(aberta.round).toBe(rodada);

        ultimo = await jogar('logica', aberta, 10);
        expect(ultimo.roundPassed).toBe(true);
      }

      expect(ultimo.badgeUnlocked).toBe(true);
      // O `grade` sobe pela primeira vez sem a mao do admin (decisao 2).
      expect(ultimo.grade).toBe(1);

      await expect(estado('logica')).resolves.toMatchObject({
        status: 'conquistada',
        badgeUnlocked: true,
      });

      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(memberUid)
        .get();

      expect(perfil.data()!.grade).toBe(1);
    }, 120_000);

    it('a subcolecao efemera foi apagada ao fim', async () => {
      const docs = await firestore
        .collection(GYM_CHALLENGE_COLLECTION)
        .doc(`logica__${memberUid}`)
        .collection('active_round')
        .get();

      expect(docs.size).toBe(0);
    });

    it('o XP entrou no perfil e no ranking', async () => {
      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(memberUid)
        .get();
      const linha = await firestore
        .collection(RANKING_COLLECTION)
        .doc(memberUid)
        .get();

      expect(perfil.data()!.xp).toBeGreaterThan(0);
      // Os dois andam no mesmo lote, entao nao ha janela em que diverjam.
      expect(linha.data()!.xp).toBe(perfil.data()!.xp);
      expect(linha.data()!.badgeCount).toBe(1);
    });

    it('teste-trava: refazer uma rodada aprovada e treino, e nao paga XP', async () => {
      const antes = (
        await firestore.collection(PROFILE_COLLECTION).doc(memberUid).get()
      ).data()!.xp as number;

      // Volta para a rodada 1, que ja esta aprovada.
      await firestore
        .collection(GYM_CHALLENGE_COLLECTION)
        .doc(`logica__${memberUid}`)
        .update({ currentRound: 1 });

      const rodada = await iniciar('logica');
      expect(rodada.replay).toBe(true);

      const fim = await jogar('logica', rodada, 10);

      expect(fim.replay).toBe(true);
      expect(fim.xpAwarded).toBe(0);

      const depois = (
        await firestore.collection(PROFILE_COLLECTION).doc(memberUid).get()
      ).data()!.xp as number;

      expect(depois).toBe(antes);

      // E o resultado original continua la: um replay reprovado nao apaga a
      // aprovacao (decisao 21).
      const desafio = await firestore
        .collection(GYM_CHALLENGE_COLLECTION)
        .doc(`logica__${memberUid}`)
        .get();

      const resultados = desafio.data()!.roundResults as Record<
        string,
        { passed: boolean }
      >;
      expect(resultados['1'].passed).toBe(true);
    }, 120_000);
  });
});
