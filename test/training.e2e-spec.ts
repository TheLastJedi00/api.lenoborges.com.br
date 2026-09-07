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
  TrainingCommentListDto,
  TrainingCompletionDto,
  TrainingDto,
  TrainingListDto,
} from '../src/training/dto/training.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';

/**
 * O percurso do membro na Arena, contra o emulador (spec 023).
 *
 * **Os dois casos que mais importam são a segunda conclusão e o 403 do Dev
 * Tier.** O primeiro é onde um `if` no lugar da atomicidade do `WriteBatch`
 * transformaria o duplo clique em farm de XP; o segundo é a única regra de tier
 * desta spec, e ela mora no service -- um guard esquecido no controller
 * trancaria também a leitura, e nenhum teste unitário perceberia a diferença.
 */
describe('Arena de Treinamento — membro (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const createdTrainingIds: string[] = [];

  let adminToken: string;
  let pagoToken: string;
  let pagoUid: string;
  let gratuitoToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-arena-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

    const pago = await createSession({ tier: 'great-dev-tier' });
    pagoToken = pago.token;
    pagoUid = pago.uid;

    gratuitoToken = (await createSession({ tier: 'dev-tier' })).token;
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

  describe('a trilha do membro', () => {
    it('lista os desafios da insígnia, na ordem, com `completed` falso', async () => {
      const primeiro = await criarTreinamento('Primeiro desafio');
      const segundo = await criarTreinamento('Segundo desafio');

      const response = await request(app.getHttpServer())
        .get('/badges/logica/trainings')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(200);

      const { trainings } = response.body as TrainingListDto;
      const ids = trainings.map((item) => item.id);

      expect(ids).toContain(primeiro.id);
      expect(ids).toContain(segundo.id);
      expect(ids.indexOf(primeiro.id)).toBeLessThan(ids.indexOf(segundo.id));
    });

    it('responde 404 para uma insígnia que não existe na trilha', async () => {
      await request(app.getHttpServer())
        .get('/badges/nao-existe/trainings')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(404);
    });

    it('exige sessão', async () => {
      await request(app.getHttpServer())
        .get('/badges/logica/trainings')
        .expect(401);
    });
  });

  describe('concluir e ganhar XP', () => {
    it('paga o XP do desafio e devolve o total do servidor', async () => {
      const treinamento = await criarTreinamento('Vale trinta', 30);
      const antes = await xpDe(pagoToken);

      const response = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      const body = response.body as TrainingCompletionDto;

      expect(body.completed).toBe(true);
      expect(body.xpAwarded).toBe(30);
      expect(body.xp).toBe(antes + 30);
    });

    /**
     * **O caso que a decisão 3 existe para garantir.**
     *
     * A segunda conclusão responde sucesso, paga zero e não move o XP. Quem
     * impede o segundo pagamento é o `ALREADY_EXISTS` derrubando o lote inteiro,
     * e não um `if` antes da escrita — e é contra o Firestore de verdade que
     * isso se prova.
     */
    it('concluir de novo não duplica XP', async () => {
      const treinamento = await criarTreinamento('Duplo clique', 40);

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      const depoisDaPrimeira = await xpDe(pagoToken);

      const segunda = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      expect((segunda.body as TrainingCompletionDto).completed).toBe(true);
      expect((segunda.body as TrainingCompletionDto).xpAwarded).toBe(0);
      expect(await xpDe(pagoToken)).toBe(depoisDaPrimeira);
    });

    it('a listagem passa a mostrar `completed` para quem concluiu, e só para ele', async () => {
      const treinamento = await criarTreinamento('Só do pago');

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(201);

      const doPago = await request(app.getHttpServer())
        .get('/badges/logica/trainings')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(200);
      const doGratuito = await request(app.getHttpServer())
        .get('/badges/logica/trainings')
        .set('Authorization', `Bearer ${gratuitoToken}`)
        .expect(200);

      const achar = (body: TrainingListDto) =>
        body.trainings.find((item) => item.id === treinamento.id);

      expect(achar(doPago.body as TrainingListDto)?.completed).toBe(true);
      expect(achar(doGratuito.body as TrainingListDto)?.completed).toBe(false);
    });

    /**
     * **XP é moeda, e o `trainingId` vem da URL.**
     *
     * Uma rota que cunha XP a partir de uma string do cliente cunha a partir de
     * qualquer string. O desafio precisa existir antes de o XP ser pago.
     */
    it('responde 404 para um treinamento inexistente, sem pagar nada', async () => {
      const antes = await xpDe(pagoToken);

      await request(app.getHttpServer())
        .post('/trainings/fantasma-que-nao-existe/complete')
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(404);

      expect(await xpDe(pagoToken)).toBe(antes);
    });

    it('o Dev Tier também conclui e ganha XP: a restrição é só de comentário', async () => {
      const treinamento = await criarTreinamento('Aberto a todos', 30);

      const response = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/complete`)
        .set('Authorization', `Bearer ${gratuitoToken}`)
        .expect(201);

      expect((response.body as TrainingCompletionDto).xpAwarded).toBe(30);
    });
  });

  describe('comentar, e o portão do tier', () => {
    /**
     * **O 403 do Dev Tier, e o 200 da leitura logo em seguida.**
     *
     * Os dois juntos são o teste: a regra é de escrita, e não de acesso. Um
     * guard de tier no controller deixaria o primeiro verde e quebraria o
     * segundo, e sem os dois no mesmo lugar ninguém notaria.
     */
    it('recusa o Dev Tier com 403, mas deixa ele ler a conversa', async () => {
      const treinamento = await criarTreinamento('Com conversa');

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${gratuitoToken}`)
        .send({ content: 'Travei no passo 2' })
        .expect(403);

      await request(app.getHttpServer())
        .get(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${gratuitoToken}`)
        .expect(200);
    });

    it('a mensagem do 403 diz o caminho para assinar', async () => {
      const treinamento = await criarTreinamento('Com portão');

      const response = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${gratuitoToken}`)
        .send({ content: 'Oi' })
        .expect(403);

      expect((response.body as { message: string }).message).toMatch(
        /Financeiro/i,
      );
    });

    it('aceita o Great Tier e fotografa o primeiro nome de quem escreveu', async () => {
      const treinamento = await criarTreinamento('Com comentário');

      const response = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'Travei no passo 2' })
        .expect(201);

      const body = response.body as { authorName: string; adminReply: null };

      expect(body.authorName).toBeTruthy();
      expect(body.adminReply).toBeNull();
    });

    it('não devolve o uid de quem escreveu', async () => {
      const treinamento = await criarTreinamento('Sem uid');

      const response = await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: 'Oi' })
        .expect(201);

      expect(Object.keys(response.body as object).sort()).toEqual([
        'adminReply',
        'authorName',
        'content',
        'createdAt',
        'id',
        'trainingId',
      ]);
      expect(JSON.stringify(response.body)).not.toContain(pagoUid);
    });

    it('lista os comentários do mais recente para o mais antigo', async () => {
      const treinamento = await criarTreinamento('Com dois comentários');

      for (const texto of ['Primeiro', 'Segundo']) {
        await request(app.getHttpServer())
          .post(`/trainings/${treinamento.id}/comments`)
          .set('Authorization', `Bearer ${pagoToken}`)
          .send({ content: texto })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .get(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(200);

      const { comments, nextCursor } = response.body as TrainingCommentListDto;

      expect(comments.map((item) => item.content)).toEqual([
        'Segundo',
        'Primeiro',
      ]);
      expect(nextCursor).toBeNull();
    });

    it('recusa comentário vazio', async () => {
      const treinamento = await criarTreinamento('Sem texto');

      await request(app.getHttpServer())
        .post(`/trainings/${treinamento.id}/comments`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .send({ content: '   ' })
        .expect(400);
    });

    it('recusa um limite que não é página', async () => {
      const treinamento = await criarTreinamento('Com limite ruim');

      await request(app.getHttpServer())
        .get(`/trainings/${treinamento.id}/comments?limit=0`)
        .set('Authorization', `Bearer ${pagoToken}`)
        .expect(400);
    });
  });
});
