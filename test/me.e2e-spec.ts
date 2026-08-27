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
import { WAITLIST_COLLECTION } from '../src/waitlist/waitlist.repository';
import { MURAL_COLLECTION } from '../src/mural/mural.repository';
import { NOTIFICATION_READ_SUBCOLLECTION } from '../src/notifications/notification-read.repository';
import { ANONYMOUS_AUTHOR_UID } from '../src/mural/entities/mural-question.entity';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';
import { MuralQuestionDto } from '../src/mural/dto/mural-question.dto';

/**
 * Meu Perfil (spec 013), ponta a ponta.
 *
 * O que este arquivo prova é a **exclusão de conta**: que cada coleção com dado
 * pessoal fica vazia, que a pergunta do Mural sobrevive anônima com o texto
 * intacto, que o voto dado sai e o contador alheio acompanha, e que o usuário do
 * Auth é o último a morrer.
 *
 * A confirmação da troca de e-mail não está aqui de propósito: o
 * VERIFY_AND_CHANGE_EMAIL só termina quando alguém clica no link, e nenhum teste
 * automatizado abre caixa de entrada. Aquela verificação é manual, e está na
 * Fase 06 da spec.
 */
describe('Meu Perfil (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdQuestionIds: string[] = [];
  const createdWaitlistIds: string[] = [];

  const SENHA = 'MinhaSenhaSegura123';

  const uniqueEmail = (prefix: string) =>
    `e2e-me-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createSession(
    options: { admin?: boolean; tier?: string } = {},
  ): Promise<{ token: string; uid: string; email: string }> {
    const email = uniqueEmail(options.admin ? 'admin' : 'membro');

    const user = await firebase.auth.createUser({
      email,
      password: SENHA,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    if (options.admin) {
      await firebase.auth.setCustomUserClaims(user.uid, { role: 'admin' });
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: SENHA })
      .expect(200);

    // O login cria o perfil. O tier é concedido depois, à mão — que é como o
    // produto funciona hoje: sem checkout, o acesso também é manual.
    if (options.tier && options.tier !== 'dev-tier') {
      await firestore
        .collection(PROFILE_COLLECTION)
        .doc(user.uid)
        .update({ tier: options.tier });
    }

    const token = (response.body as SessionResponseDto).accessToken;
    // Sem isto a proxima requisicao desta sessao responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    return {
      token,
      uid: user.uid,
      email,
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
    for (const questionId of createdQuestionIds) {
      try {
        await firestore.collection(MURAL_COLLECTION).doc(questionId).delete();
      } catch {
        // ignore cleanup error
      }
    }
    for (const waitlistId of createdWaitlistIds) {
      try {
        await firestore
          .collection(WAITLIST_COLLECTION)
          .doc(waitlistId)
          .delete();
      } catch {
        // ignore cleanup error
      }
    }
    await app.close();
  });

  describe('PATCH /me/profile', () => {
    it('grava as redes sociais e as devolve no perfil', async () => {
      const { token } = await createSession();

      const atualizado = await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Uma bio suficientemente longa para passar.',
          linkedin: 'https://www.linkedin.com/in/fulano',
        })
        .expect(200);

      expect((atualizado.body as ProfileDto).linkedin).toBe(
        'https://www.linkedin.com/in/fulano',
      );
      expect((atualizado.body as ProfileDto).instagram).toBeNull();
    });

    it('teste-trava: um PATCH sem as redes nao apaga a rede guardada', async () => {
      const { token } = await createSession();

      await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Uma bio suficientemente longa para passar.',
          instagram: 'https://instagram.com/fulano',
        })
        .expect(200);

      const semRedes = await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Outra bio, tambem suficientemente longa.',
        })
        .expect(200);

      expect((semRedes.body as ProfileDto).instagram).toBe(
        'https://instagram.com/fulano',
      );
    });

    it('recusa URL que so contem o dominio no query string', async () => {
      const { token } = await createSession();

      await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Uma bio suficientemente longa para passar.',
          linkedin: 'https://evil.com/?u=linkedin.com',
        })
        .expect(400);
    });
  });

  describe('POST /me/password', () => {
    it('senha atual errada da 401, e a senha antiga continua valendo', async () => {
      const { token, email } = await createSession();

      await request(app.getHttpServer())
        .post('/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'nao-e-essa', newPassword: 'OutraSenha123' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: SENHA })
        .expect(200);
    });

    it('troca a senha, encerra a sessao e o login passa a ser com a nova', async () => {
      const { token, email } = await createSession();
      const novaSenha = 'MinhaOutraSenha456';

      const resposta = await request(app.getHttpServer())
        .post('/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: SENHA, newPassword: novaSenha })
        .expect(204);

      // O cookie de refresh é apagado na resposta: sem isto o navegador segue
      // tentando renovar com um token que não vale mais.
      expect(String(resposta.headers['set-cookie'])).toContain('eduleno_rt=');

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: SENHA })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: novaSenha })
        .expect(200);
    });
  });

  describe('POST /me/email', () => {
    it('e-mail novo igual ao atual da 400', async () => {
      const { token, email } = await createSession();

      await request(app.getHttpServer())
        .post('/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: email, password: SENHA })
        .expect(400);
    });

    it('senha errada da 401', async () => {
      const { token } = await createSession();

      await request(app.getHttpServer())
        .post('/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ newEmail: uniqueEmail('novo'), password: 'nao-e-essa' })
        .expect(401);
    });
  });

  describe('DELETE /me', () => {
    it('admin recebe 403 e continua existindo', async () => {
      const { token, uid } = await createSession({ admin: true });

      await request(app.getHttpServer())
        .delete('/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: SENHA })
        .expect(403);

      await expect(firebase.auth.getUser(uid)).resolves.toBeDefined();
    });

    it('senha errada da 401 e nada e apagado', async () => {
      const { token, uid } = await createSession();

      await request(app.getHttpServer())
        .delete('/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'nao-e-essa' })
        .expect(401);

      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .get();
      expect(perfil.exists).toBe(true);
    });

    /**
     * O caso completo: perfil, leitura de notificação, pergunta própria, voto em
     * pergunta alheia e entrada na lista de espera. Depois da exclusão, o que
     * some tem de sumir e o que vira anônimo tem de continuar legível.
     */
    it('apaga o que e da pessoa e anonimiza o que e da comunidade', async () => {
      const vizinho = await createSession({ tier: 'ultra-dev-tier' });
      const alvo = await createSession({ tier: 'ultra-dev-tier' });

      // A pergunta do vizinho, que vai receber o voto do alvo.
      const doVizinho = await request(app.getHttpServer())
        .post('/mural/perguntas')
        .set('Authorization', `Bearer ${vizinho.token}`)
        .send({ badgeId: 'logica', title: 'Uma pergunta do vizinho, aqui' })
        .expect(201);
      const perguntaVizinho = (doVizinho.body as MuralQuestionDto).id;
      createdQuestionIds.push(perguntaVizinho);

      // A pergunta do alvo, que precisa sobreviver anônima.
      const doAlvo = await request(app.getHttpServer())
        .post('/mural/perguntas')
        .set('Authorization', `Bearer ${alvo.token}`)
        .send({ badgeId: 'poo', title: 'A pergunta que deve sobreviver' })
        .expect(201);
      const perguntaAlvo = (doAlvo.body as MuralQuestionDto).id;
      createdQuestionIds.push(perguntaAlvo);

      // O voto plantado à mão com o contador junto: a fase da semana não deixa
      // votar pela API, e o que este teste verifica é a limpeza.
      await firestore
        .collection(MURAL_COLLECTION)
        .doc(perguntaVizinho)
        .collection('votes')
        .doc(alvo.uid)
        .set({ votedAt: new Date() });
      await firestore
        .collection(MURAL_COLLECTION)
        .doc(perguntaVizinho)
        .update({ voteCount: 1 });

      // Uma leitura de notificação, na subcoleção que some da tela e fica no
      // banco quando ninguém a apaga explicitamente.
      await firestore
        .collection(PROFILE_COLLECTION)
        .doc(alvo.uid)
        .collection(NOTIFICATION_READ_SUBCOLLECTION)
        .doc('notificacao-qualquer')
        .set({ readAt: new Date() });

      // A inscrição na lista de espera: nome, telefone e e-mail crus.
      const waitlistId = alvo.email;
      createdWaitlistIds.push(waitlistId);
      await firestore.collection(WAITLIST_COLLECTION).doc(waitlistId).set({
        id: waitlistId,
        name: 'Fulano de Tal',
        phone: '47999990000',
        email: waitlistId,
        consent: true,
        createdAt: new Date(),
      });
      await firestore
        .collection(PROFILE_COLLECTION)
        .doc(alvo.uid)
        .update({ waitlistEntryId: waitlistId });

      await request(app.getHttpServer())
        .delete('/me')
        .set('Authorization', `Bearer ${alvo.token}`)
        .send({ password: SENHA })
        .expect(204);

      // 1. A pergunta do alvo fica, anônima, com o texto intacto.
      const sobreviveu = await firestore
        .collection(MURAL_COLLECTION)
        .doc(perguntaAlvo)
        .get();
      expect(sobreviveu.exists).toBe(true);
      expect(sobreviveu.data()?.authorUid).toBe(ANONYMOUS_AUTHOR_UID);
      expect(sobreviveu.data()?.authorName).toBe('Membro removido');
      expect(sobreviveu.data()?.title).toBe('A pergunta que deve sobreviver');
      expect(sobreviveu.data()?.badgeId).toBe('poo');

      // 2. O voto sumiu, e o contador do vizinho acompanhou.
      const voto = await firestore
        .collection(MURAL_COLLECTION)
        .doc(perguntaVizinho)
        .collection('votes')
        .doc(alvo.uid)
        .get();
      expect(voto.exists).toBe(false);

      const vizinhoDepois = await firestore
        .collection(MURAL_COLLECTION)
        .doc(perguntaVizinho)
        .get();
      expect(vizinhoDepois.data()?.voteCount).toBe(0);

      // 3. O perfil e a subcoleção — a que some da tela e fica no banco.
      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(alvo.uid)
        .get();
      expect(perfil.exists).toBe(false);

      const leituras = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(alvo.uid)
        .collection(NOTIFICATION_READ_SUBCOLLECTION)
        .listDocuments();
      expect(leituras.length).toBe(0);

      // 4. A lista de espera.
      const waitlist = await firestore
        .collection(WAITLIST_COLLECTION)
        .doc(waitlistId)
        .get();
      expect(waitlist.exists).toBe(false);

      // 5. E o usuário do Auth, que morre por último.
      await expect(firebase.auth.getUser(alvo.uid)).rejects.toThrow();
    });
  });
});
