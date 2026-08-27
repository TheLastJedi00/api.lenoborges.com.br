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
   * O 304 vazio que abriu o Mural em branco num celular (fix.md da spec 016).
   *
   * O que este teste tranca é o `no-store`: sem ele o browser guarda o par
   * (ETag, corpo), revalida com `If-None-Match` e recebe 304 sem corpo — e se
   * o corpo já tiver sido despejado do cache, a tela não tem o que renderizar.
   *
   * O que ele **não** tranca, porque não é verdade: o `no-store` não desliga o
   * ETag. Um cliente que mande `If-None-Match` na mão continua recebendo 304
   * (conferido no Express 5.2.1). A defesa é o browser nunca guardar o
   * validador, não o servidor recusar a revalidação.
   */
  it.each(['/mural', '/mural/perguntas', '/mural/vencedoras'])(
    '%s manda o browser não guardar a resposta',
    async (path) => {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${paidToken}`)
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toBeDefined();
    },
  );

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

  /**
   * **O adiantamento, ponta a ponta** (spec 016). Uma pergunta da semana em
   * coleta nao aceita voto; depois do `PATCH` do admin, tres coisas mudam de
   * uma vez e nenhuma delas tem regra propria: ela aceita voto, ela sai da aba
   * de coleta, e o autor recebe 409 ao tentar editar.
   *
   * E o unico lugar onde a decisao 1 desta spec e verificavel de ponta a
   * ponta: uma coisa mudou de lugar -- `phaseOf` -- e tres comportamentos
   * obedeceram.
   */
  it('adiantar para votacao abre o voto, tira da coleta e tranca a edicao', async () => {
    const autor = await createSession({ tier: 'great-dev-tier' });

    const criada = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${autor.token}`)
      .send({
        badgeId: 'logica',
        title: 'Uma pergunta que merece ser adiantada',
      })
      .expect(201);

    const pergunta = criada.body as MuralQuestionDto;
    createdQuestionIds.push(pergunta.id);

    expect(pergunta.phase).toBe('coleta');
    expect(pergunta.promotedTo).toBeNull();

    // Antes: nao aceita voto, e o autor edita a vontade.
    await request(app.getHttpServer())
      .post(`/mural/perguntas/${pergunta.id}/voto`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(409);

    await request(app.getHttpServer())
      .put(`/mural/perguntas/${pergunta.id}`)
      .set('Authorization', `Bearer ${autor.token}`)
      .send({ title: 'Uma pergunta que merece ser adiantada, revisada' })
      .expect(200);

    const promovida = await request(app.getHttpServer())
      .patch(`/admin/mural/perguntas/${pergunta.id}/fase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fase: 'votacao' })
      .expect(200);

    expect((promovida.body as MuralQuestionDto).promotedTo).toBe('votacao');
    expect((promovida.body as MuralQuestionDto).phase).toBe('votacao');

    // Depois: aceita voto.
    await request(app.getHttpServer())
      .post(`/mural/perguntas/${pergunta.id}/voto`)
      .set('Authorization', `Bearer ${freeToken}`)
      .expect(204);

    // Depois: mudou de aba, e continua com o weekId da coleta.
    const naColeta = await request(app.getHttpServer())
      .get('/mural/perguntas?fase=coleta')
      .set('Authorization', `Bearer ${autor.token}`)
      .expect(200);
    const naVotacao = await request(app.getHttpServer())
      .get('/mural/perguntas?fase=votacao')
      .set('Authorization', `Bearer ${autor.token}`)
      .expect(200);

    const ids = (corpo: unknown) =>
      (corpo as MuralQuestionDto[]).map((item) => item.id);

    expect(ids(naColeta.body)).not.toContain(pergunta.id);
    expect(ids(naVotacao.body)).toContain(pergunta.id);

    // Depois: o texto nao muda mais, porque quem votou votou nele.
    await request(app.getHttpServer())
      .put(`/mural/perguntas/${pergunta.id}`)
      .set('Authorization', `Bearer ${autor.token}`)
      .send({ title: 'Tentando mudar depois de adiantada' })
      .expect(409);

    // E a vaga da semana continua ocupada: adiantar nao libera pergunta nova.
    const estado = await request(app.getHttpServer())
      .get('/mural')
      .set('Authorization', `Bearer ${autor.token}`)
      .expect(200);

    expect((estado.body as MuralStateDto).canAsk).toBe(false);
  });

  /**
   * A promocao e de mao unica: o caminho de arrependimento e o `DELETE`.
   */
  it('recusa despromover, e recusa promover para a fase em que ja esta', async () => {
    const autor = await createSession({ tier: 'great-dev-tier' });

    const criada = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${autor.token}`)
      .send({ badgeId: 'poo', title: 'Uma pergunta para testar a mao unica' })
      .expect(201);

    const id = (criada.body as MuralQuestionDto).id;
    createdQuestionIds.push(id);

    // 'coleta' nem chega ao service: a validacao recusa antes.
    await request(app.getHttpServer())
      .patch(`/admin/mural/perguntas/${id}/fase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fase: 'coleta' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/admin/mural/perguntas/${id}/fase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fase: 'encerrada' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/admin/mural/perguntas/${id}/fase`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fase: 'votacao' })
      .expect(409);
  });

  it('membro comum recebe 403 ao tentar adiantar', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/mural/perguntas/${createdQuestionIds[0]}/fase`)
      .set('Authorization', `Bearer ${paidToken}`)
      .send({ fase: 'votacao' })
      .expect(403);
  });

  /**
   * **O contrato de que o formulario de edicao depende** (spec 016, decisao 9).
   * Sem `myQuestion`, a tela de editar abre em branco e editar e reescrever.
   */
  it('GET /mural devolve a propria pergunta inteira, com o texto integro', async () => {
    const autor = await createSession({ tier: 'great-dev-tier' });

    const criada = await request(app.getHttpServer())
      .post('/mural/perguntas')
      .set('Authorization', `Bearer ${autor.token}`)
      .send({
        badgeId: 'poo',
        title: 'O titulo que precisa voltar inteiro',
        body: 'E o corpo, que tambem precisa voltar inteiro.',
      })
      .expect(201);

    createdQuestionIds.push((criada.body as MuralQuestionDto).id);

    const estado = await request(app.getHttpServer())
      .get('/mural')
      .set('Authorization', `Bearer ${autor.token}`)
      .expect(200);

    const state = estado.body as MuralStateDto;

    expect(state.myQuestion).not.toBeNull();
    expect(state.myQuestion?.id).toBe(state.myQuestionId);
    expect(state.myQuestion?.title).toBe('O titulo que precisa voltar inteiro');
    expect(state.myQuestion?.body).toBe(
      'E o corpo, que tambem precisa voltar inteiro.',
    );
    expect(state.myQuestion?.badgeId).toBe('poo');
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

  /**
   * **As decisoes 3, 4 e 5 juntas, e a invariante do adiantamento.**
   *
   * A mais votada da semana, adiantada, nao vence: quem vence e a segunda. E a
   * semana que teve uma adiantada **continua tendo vencedora** -- ficar de fora
   * da conta e diferente de esvaziar a conta.
   *
   * A segunda pergunta e semeada **sem o campo `promotedTo`**, de proposito: e
   * a armadilha do `== null` da decisao 4. Um `where('promotedTo','==',null)`
   * na consulta da vencedora nao a enxergaria, e a semana apareceria em branco
   * com a resposta 200.
   */
  it('a semana com uma adiantada continua tendo vencedora, e a pauta tem as duas origens', async () => {
    const estado = await request(app.getHttpServer())
      .get('/mural')
      .set('Authorization', `Bearer ${paidToken}`)
      .expect(200);

    // A encerrada mais recente: uma semana antes da que esta em votacao.
    const votingWeekId = (estado.body as MuralStateDto).votingWeekId;
    const encerrada = new Date(
      new Date(`${votingWeekId}T00:00:00.000Z`).getTime() - 7 * 86400000,
    )
      .toISOString()
      .slice(0, 10);

    const agora = new Date();
    const semear = async (
      sufixo: string,
      dados: Record<string, unknown>,
    ): Promise<string> => {
      const id = `${encerrada}__e2e-${sufixo}-${Date.now()}`;
      await firestore
        .collection(MURAL_COLLECTION)
        .doc(id)
        .set({
          weekId: encerrada,
          badgeId: 'poo',
          authorUid: `e2e-${sufixo}`,
          authorName: 'Membro',
          body: null,
          answerVideoId: null,
          createdAt: agora,
          updatedAt: agora,
          ...dados,
        });
      createdQuestionIds.push(id);
      return id;
    };

    const adiantadaId = await semear('adiantada', {
      title: 'A mais votada, que o admin adiantou',
      voteCount: 20,
      promotedTo: 'encerrada',
    });
    // Sem o campo `promotedTo`, como todo documento anterior a spec 016.
    const segundaId = await semear('segunda', {
      title: 'A segunda mais votada, que vence a semana',
      voteCount: 7,
    });

    const pauta = await request(app.getHttpServer())
      .get('/mural/vencedoras')
      .set('Authorization', `Bearer ${paidToken}`)
      .expect(200);

    const linhas = pauta.body as {
      weekId: string;
      question: MuralQuestionDto | null;
      origem: string;
    }[];

    const vencedora = linhas.find(
      (linha) => linha.weekId === encerrada && linha.origem === 'voto',
    );
    expect(vencedora?.question?.id).toBe(segundaId);

    const adiantadas = linhas.filter(
      (linha) => linha.question?.id === adiantadaId,
    );
    expect(adiantadas.length).toBe(1);
    expect(adiantadas[0].origem).toBe('adiantada');
  });
});
