import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { MURAL_COLLECTION } from '../src/mural/mural.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { MuralStateDto } from '../src/mural/dto/mural-state.dto';
import { MuralQuestionDto } from '../src/mural/dto/mural-question.dto';

describe('Mural (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdQuestionIds: string[] = [];

  let adminToken: string;
  let paidToken: string;
  let paidId: string;
  let freeToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-mural-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createSession(options: {
    admin?: boolean;
    tier?: string;
  }): Promise<{ token: string; uid: string }> {
    const email = uniqueEmail(options.tier ?? 'membro');
    const password = 'MinhaSenhaSegura123';

    const user = await firebase.auth.createUser({
      email,
      password,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    if (options.admin) {
      await firebase.auth.setCustomUserClaims(user.uid, { role: 'admin' });
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    // O login cria o perfil. O tier é concedido depois, à mão — que é como o
    // produto funciona hoje: sem checkout, o acesso também é manual.
    if (options.tier && options.tier !== 'dev-tier') {
      await firestore
        .collection(PROFILE_COLLECTION)
        .doc(user.uid)
        .update({ tier: options.tier });
    }

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

    adminToken = (await createSession({ admin: true, tier: 'ultra-dev-tier' }))
      .token;

    const paid = await createSession({ tier: 'great-dev-tier' });
    paidToken = paid.token;
    paidId = paid.uid;

    freeToken = (await createSession({ tier: 'dev-tier' })).token;
  });

  afterAll(async () => {
    for (const questionId of createdQuestionIds) {
      try {
        const question = firestore.collection(MURAL_COLLECTION).doc(questionId);
        const votes = await question.collection('votes').listDocuments();
        for (const vote of votes) {
          await vote.delete();
        }
        await question.delete();
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

  it('sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/mural').expect(401);
  });

  /**
   * A virada é uma conta: o estado sai do relógio do servidor a cada leitura, e
   * ninguém precisou rodar job nenhum para ele existir.
   */
  it('devolve o estado do ciclo, com as duas semanas vivas', async () => {
    const response = await request(app.getHttpServer())
      .get('/mural')
      .set('Authorization', `Bearer ${paidToken}`)
      .expect(200);

    const state = response.body as MuralStateDto;

    expect(state.currentWeekId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.votingWeekId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.currentWeekId).not.toBe(state.votingWeekId);
    // A virada é meia-noite em São Paulo, que é 03:00 UTC.
    expect(state.currentWeekEndsAt).toMatch(/T03:00:00\.000Z$/);
  });

  /**
   * **O portão da spec 010, ponta a ponta.** Dev Tier vota, mas não escreve — e
   * a resposta precisa dizer para onde ir, não só que não pode.
   */
  it('Dev Tier lê o mural mas não escreve pergunta', async () => {
    const state = await request(app.getHttpServer())
      .get('/mural')
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(200);

    expect((state.body as MuralStateDto).canAsk).toBe(false);

    const recusa = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${freeToken}`)
      .send({ badgeId: 'poo', title: 'Uma pergunta bem formulada aqui' })
      .expect(403);

    expect((recusa.body as { message: string }).message).toContain(
      'Financeiro',
    );
  });

  it('membro pago escreve, e a segunda pergunta da semana recebe 409', async () => {
    const criada = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${paidToken}`)
      .send({
        badgeId: 'poo',
        title: 'Como saber quando usar herança em vez de composição?',
      })
      .expect(201);

    const question = criada.body as MuralQuestionDto;
    createdQuestionIds.push(question.id);

    // O caminho do documento é `{weekId}__{uid}`: a garantia é o endereço.
    expect(question.id).toBe(`${question.weekId}__${paidId}`);
    expect(question.voteCount).toBe(0);
    expect(question.authorName).not.toContain(' ');

    await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${paidToken}`)
      .send({ badgeId: 'logica', title: 'Outra pergunta na mesma semana' })
      .expect(409);
  });

  /**
   * Não se vota na semana em coleta. Quem publicasse domingo de manhã teria sete
   * dias de vantagem sobre quem publicasse sábado à noite.
   */
  it('recusa votar numa pergunta da semana em coleta', async () => {
    const questionId = createdQuestionIds[0];

    await request(app.getHttpServer())
      .post(`/mural/perguntas/${questionId}/voto`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(409);
  });

  it('recusa insígnia que não existe na trilha', async () => {
    await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ badgeId: 'inventada', title: 'Uma pergunta bem formulada aqui' })
      .expect(400);
  });

  it('recusa título curto demais', async () => {
    await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ badgeId: 'poo', title: 'curto' })
      .expect(400);
  });

  it('membro comum recebe 403 na moderação', async () => {
    await request(app.getHttpServer())
      .delete(`/admin/mural/perguntas/${createdQuestionIds[0]}`)
      .set('Authorization', `Bearer ${paidToken}`)
      .expect(403);
  });

  /**
   * **A pegadinha clássica do Firestore:** subcoleção não desaparece com o pai.
   * Este teste é o que garante que a moderação não deixa votos órfãos —
   * invisíveis, cobrados, e impossíveis de encontrar depois.
   */
  it('a moderação apaga a pergunta e não deixa voto órfão', async () => {
    const criada = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ badgeId: 'logica', title: 'Pergunta que será moderada agora' })
      .expect(201);

    const questionId = (criada.body as MuralQuestionDto).id;

    // Um voto plantado à mão: a fase da semana não deixa votar pela API, e o que
    // este teste verifica é a limpeza, não o fluxo de voto.
    await firestore
      .collection(MURAL_COLLECTION)
      .doc(questionId)
      .collection('votes')
      .doc('uid-qualquer')
      .set({ votedAt: new Date() });

    await request(app.getHttpServer())
      .delete(`/admin/mural/perguntas/${questionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const votos = await firestore
      .collection(MURAL_COLLECTION)
      .doc(questionId)
      .collection('votes')
      .listDocuments();

    expect(votos.length).toBe(0);
  });

  it('o histórico de vencedoras inclui semanas em branco', async () => {
    const response = await request(app.getHttpServer())
      .get('/mural/vencedoras')
      .set('Authorization', `Bearer ${paidToken}`)
      .expect(200);

    const winners = response.body as { weekId: string; question: unknown }[];

    expect(winners.length).toBeGreaterThan(0);
    // Sem perguntas antigas no emulador, todas passam em branco — e isso é
    // informação honesta, não erro.
    expect(winners.every((week) => week.question === null)).toBe(true);
  });
});
