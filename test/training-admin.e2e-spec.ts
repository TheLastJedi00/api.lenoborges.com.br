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
import { TRAINING_COLLECTION } from '../src/training/training.repository';
import { TRAINING_COMMENT_COLLECTION } from '../src/training/training-comment.repository';
import { TRAINING_COMPLETION_COLLECTION } from '../src/training/training-completion.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import {
  AdminTrainingCommentListDto,
  TrainingCommentListDto,
  TrainingDto,
  TrainingListDto,
} from '../src/training/dto/training.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';

/**
 * A administração da Arena, contra o emulador (spec 023).
 *
 * **O caso que mais importa é a exclusão em cascata.** No Firestore nada some
 * junto com o pai, e um `delete` solto deixaria comentários e conclusões
 * invisíveis, cobrados e impossíveis de encontrar depois -- sem erro nenhum, e
 * sem nenhum teste unitário capaz de provar o contrário contra um mock.
 */
describe('Arena de Treinamento — admin (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdTrainingIds: string[] = [];

  let adminToken: string;
  let pagoToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-arena-admin-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

    const token = (response.body as SessionResponseDto).accessToken;
    // Sem isto a próxima requisição desta sessão responde 428 (spec 018).
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    return { token, uid: user.uid };
  }

  async function criarTreinamento(
    titulo: string,
    xpAmount?: number,
  ): Promise<TrainingDto> {
    const response = await request(app.getHttpServer())
      .post('/admin/badges/logica/trainings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: titulo,
        description: 'Um exercício de leitura antes de escrever.',
        steps: ['Clone o repositório', 'Rode os testes'],
        ...(xpAmount === undefined ? {} : { xpAmount }),
      })
      .expect(201);

    const training = response.body as TrainingDto;
    createdTrainingIds.push(training.id);

    return training;
  }

  async function xpDe(token: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return (response.body as ProfileDto).xp ?? 0;
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

    pagoToken = (await createSession({ tier: 'great-dev-tier' })).token;
  });

  afterAll(async () => {
    for (const trainingId of createdTrainingIds) {
      try {
        await firestore
          .collection(TRAINING_COLLECTION)
          .doc(trainingId)
          .delete();
      } catch {
        // ignore cleanup error
      }
    }
    for (const collection of [
      TRAINING_COMMENT_COLLECTION,
      TRAINING_COMPLETION_COLLECTION,
    ]) {
      for (const uid of createdUserIds) {
        try {
          const snapshot = await firestore
            .collection(collection)
            .where('uid', '==', uid)
            .get();
          for (const document of snapshot.docs) {
            await document.ref.delete();
          }
        } catch {
          // ignore cleanup error
        }
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

  describe('o CRUD', () => {
    it('cria no fim da lista, com a posição calculada no servidor', async () => {
      const primeiro = await criarTreinamento('Admin primeiro');
      const segundo = await criarTreinamento('Admin segundo');

      expect(segundo.position).toBe(primeiro.position + 1);
      expect(segundo.xpAmount).toBe(30);
      expect(segundo.videoUrl).toBeNull();
    });

    it('recusa um desafio sem passo nenhum', async () => {
      await request(app.getHttpServer())
        .post('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Sem passos', description: 'Descrição', steps: [] })
        .expect(400);
    });

    it('recusa uma URL de vídeo que não é URL', async () => {
      await request(app.getHttpServer())
        .post('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Com vídeo torto',
          description: 'Descrição',
          steps: ['Um'],
          videoUrl: 'nao-e-url',
        })
        .expect(400);
    });

    it('recusa a criação numa insígnia que não existe', async () => {
      await request(app.getHttpServer())
        .post('/admin/badges/nao-existe/trainings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Órfão', description: 'Descrição', steps: ['Um'] })
        .expect(404);
    });

    it('edita o desafio', async () => {
      const treinamento = await criarTreinamento('Título velho');

      const response = await request(app.getHttpServer())
        .patch(`/admin/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Título novo', xpAmount: 55 })
        .expect(200);

      const body = response.body as TrainingDto;

      expect(body.title).toBe('Título novo');
      expect(body.xpAmount).toBe(55);
      expect(body.steps).toEqual(treinamento.steps);
    });
  });

  describe('o portão do admin', () => {
    it('recusa membro comum em todas as rotas de administração', async () => {
      const treinamento = await criarTreinamento('Protegido');

      await request(app.getHttpServer())
        .get('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ title: 'x', description: 'y', steps: ['z'] })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/admin/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ title: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/admin/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/admin/trainings/comments/recent')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(403);
    });
  });

  describe('a reordenação', () => {
    it('renormaliza a insígnia para 0..n-1 na ordem enviada', async () => {
      const lista = await request(app.getHttpServer())
        .get('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const atual = (lista.body as TrainingListDto).trainings.map(
        (item) => item.id,
      );
      const invertida = [...atual].reverse();

      await request(app.getHttpServer())
        .patch('/admin/badges/logica/trainings/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderedIds: invertida })
        .expect(204);

      const depois = await request(app.getHttpServer())
        .get('/admin/badges/logica/trainings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { trainings } = depois.body as TrainingListDto;

      expect(trainings.map((item) => item.id)).toEqual(invertida);
      expect(trainings.map((item) => item.position)).toEqual(
        invertida.map((_, index) => index),
      );
    });

    /**
     * A ordem que não bate é 400 **antes de qualquer escrita**.
     *
     * Deixar passar gravaria posições sobre uma lista que já mudou embaixo do
     * admin, e o resultado seria dois desafios na mesma posição.
     */
    it('recusa uma ordem que não cobre a insígnia inteira', async () => {
      const treinamento = await criarTreinamento('Sozinho na lista');

      await request(app.getHttpServer())
        .patch('/admin/badges/logica/trainings/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ orderedIds: [treinamento.id] })
        .expect(400);
    });
  });

  describe('a exclusão em cascata', () => {
    /**
     * **O teste que vale a suíte inteira.**
     *
     * Excluir o desafio apaga os comentários e as conclusões dele. Sem isso, os
     * dois ficam invisíveis, cobrados e impossíveis de encontrar depois -- e o
     * único jeito de provar que sumiram é olhando o Firestore, e não o mock.
     */
    it('apaga os comentários e as conclusões do desafio excluído', async () => {
      const treinamento = await criarTreinamento('Vai ser apagado');

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'Comentário condenado' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/admin/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const comentarios = await firestore
        .collection(TRAINING_COMMENT_COLLECTION)
        .where('trainingId', '==', treinamento.id)
        .get();
      const conclusoes = await firestore
        .collection(TRAINING_COMPLETION_COLLECTION)
        .where('trainingId', '==', treinamento.id)
        .get();

      expect(comentarios.empty).toBe(true);
      expect(conclusoes.empty).toBe(true);
      await request(app.getHttpServer())
        .get(`/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(404);
    });

    it('não devolve o XP que o desafio já tinha pago', async () => {
      const treinamento = await criarTreinamento('Pagou e sumiu', 30);

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      const antes = await xpDe(pagoToken);

      await request(app.getHttpServer())
        .delete(`/admin/trainings/${treinamento.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      expect(await xpDe(pagoToken)).toBe(antes);
    });
  });

  describe('o painel centralizado de comentários', () => {
    it('lista os comentários recentes com o título do desafio de origem', async () => {
      const treinamento = await criarTreinamento('Com origem');

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'De onde é este comentário?' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/admin/trainings/comments/recent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const linha = (
        response.body as AdminTrainingCommentListDto
      ).comments.find((item) => item.content === 'De onde é este comentário?');

      expect(linha).toBeDefined();
      expect(linha?.trainingTitle).toBe('Com origem');
      expect(linha?.badgeId).toBe('logica');
    });

    it('grava a resposta no próprio comentário, e o membro a enxerga', async () => {
      const treinamento = await criarTreinamento('Com resposta');

      const criado = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'Travei no passo 2' })
        .expect(201);

      const commentId = (criado.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/admin/trainings/comments/${commentId}/reply`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Rode npm ci antes: o lock estava velho.' })
        .expect(201);

      const doMembro = await request(app.getHttpServer())
        .get(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(200);

      const comentario = (
        doMembro.body as TrainingCommentListDto
      ).comments.find((item) => item.id === commentId);

      expect(comentario?.adminReply?.content).toBe(
        'Rode npm ci antes: o lock estava velho.',
      );
      expect(comentario?.adminReply?.authorName).toBeTruthy();
    });

    it('responder de novo sobrescreve a resposta anterior', async () => {
      const treinamento = await criarTreinamento('Com correção');

      const criado = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'Deu erro' })
        .expect(201);

      const commentId = (criado.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/admin/trainings/comments/${commentId}/reply`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Primeira tentativa' })
        .expect(201);

      const segunda = await request(app.getHttpServer())
        .post(`/admin/trainings/comments/${commentId}/reply`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Na verdade, é o Node 22.' })
        .expect(201);

      expect(
        (segunda.body as { adminReply: { content: string } }).adminReply
          .content,
      ).toBe('Na verdade, é o Node 22.');
    });

    it('responde 404 ao comentário que não existe', async () => {
      await request(app.getHttpServer())
        .post('/admin/trainings/comments/fantasma/reply')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Oi' })
        .expect(404);
    });
  });
});
