import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { LEGAL_ACCEPTANCE_SUBCOLLECTION } from '../src/legal/legal-acceptance.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { ProfileDto } from '../src/profile/dto/profile.dto';
import { acceptCurrentLegalDocuments } from './accept-legal.helper';

/**
 * Termos de Uso e Politica de Privacidade (spec 018), ponta a ponta.
 *
 * **Este e o unico arquivo da suite que ve o bloqueio de pe.** Todas as outras
 * `createSession` aceitam os documentos logo depois do login, entao nenhuma
 * delas cobraria a existencia do `LegalAcceptanceGuard` -- apagar o guard as
 * deixaria verdes. E aqui que a regra e verificada, e por isso o primeiro caso
 * bate no `428` de proposito, antes de aceitar qualquer coisa.
 */
describe('Legal (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  const SENHA = 'MinhaSenhaSegura123';

  const uniqueEmail = () =>
    `e2e-legal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  /** Sessao **sem aceitar nada**: e este o estado que o guard existe para pegar. */
  async function createRawSession(): Promise<{ token: string; uid: string }> {
    const email = uniqueEmail();
    const user = await firebase.auth.createUser({
      email,
      password: SENHA,
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: SENHA })
      .expect(200);

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
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await firebase.auth.deleteUser(userId);
      } catch {
        // ignore cleanup error
      }
      try {
        const acceptances = await firestore
          .collection(PROFILE_COLLECTION)
          .doc(userId)
          .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
          .listDocuments();
        for (const ref of acceptances) {
          await ref.delete();
        }
        await firestore.collection(PROFILE_COLLECTION).doc(userId).delete();
      } catch {
        // ignore cleanup error
      }
    }
    await app.close();
  });

  describe('leitura publica', () => {
    /**
     * O rodape da landing aponta para ca, e quem le ali ainda nao tem conta.
     * **Exigir login para ler o contrato e exigir que a pessoa concorde antes de
     * poder ler** -- e um `authGuard` colado por habito nesta rota quebraria
     * isso sem que mais nada falhasse.
     */
    it('teste-trava: GET /legal/documents funciona SEM sessao', async () => {
      const response = await request(app.getHttpServer())
        .get('/legal/documents')
        .expect(200);

      expect(response.body).toEqual([
        { id: 'termos-de-uso', title: 'Termos de Uso', version: '2026-08-27' },
        {
          id: 'politica-de-privacidade',
          title: 'Política de Privacidade',
          version: '2026-08-27',
        },
      ]);
    });

    it('o documento vem inteiro, e sem sessao', async () => {
      const response = await request(app.getHttpServer())
        .get('/legal/documents/termos-de-uso')
        .expect(200);

      const documento = response.body as { sections: unknown[] };
      expect(documento.sections.length).toBeGreaterThan(0);
    });

    it('documento inexistente e 404', async () => {
      await request(app.getHttpServer())
        .get('/legal/documents/contrato-inexistente')
        .expect(404);
    });
  });

  describe('o bloqueio', () => {
    it('teste-trava: sessao sem aceite toma 428 no painel, com a lista do que falta', async () => {
      const { token } = await createRawSession();

      const response = await request(app.getHttpServer())
        .get('/mural')
        .set('Authorization', `Bearer ${token}`)
        .expect(428);

      const corpo = response.body as {
        error: string;
        pending: { id: string }[];
      };
      expect(corpo.error).toBe('legal_acceptance_required');
      expect(corpo.pending.map((d) => d.id)).toEqual([
        'termos-de-uso',
        'politica-de-privacidade',
      ]);
    });

    /**
     * As duas saidas do bloqueio. Sem elas ninguem entra no produto nunca mais,
     * e o unico conserto seria deploy.
     */
    it('GET /me continua respondendo, e diz o que falta', async () => {
      const { token } = await createRawSession();

      const response = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as ProfileDto).pendingLegal).toHaveLength(2);
    });

    it('aceitar os dois libera o painel', async () => {
      const { token } = await createRawSession();

      await request(app.getHttpServer())
        .get('/billing/tiers')
        .set('Authorization', `Bearer ${token}`)
        .expect(428);

      await acceptCurrentLegalDocuments(app.getHttpServer(), token);

      await request(app.getHttpServer())
        .get('/billing/tiers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('aceitar so um documento NAO libera', async () => {
      const { token } = await createRawSession();

      await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'termos-de-uso', version: '2026-08-27' })
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/billing/tiers')
        .set('Authorization', `Bearer ${token}`)
        .expect(428);

      expect(
        (response.body as { pending: { id: string }[] }).pending.map(
          (d) => d.id,
        ),
      ).toEqual(['politica-de-privacidade']);
    });
  });

  describe('POST /me/legal-acceptances', () => {
    it('grava o historico na subcolecao, com a versao no caminho', async () => {
      const { token, uid } = await createRawSession();

      await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'termos-de-uso', version: '2026-08-27' })
        .expect(204);

      const doc = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
        .doc('termos-de-uso__2026-08-27')
        .get();

      expect(doc.exists).toBe(true);
      expect(doc.data()).toMatchObject({
        documentId: 'termos-de-uso',
        version: '2026-08-27',
      });
    });

    /**
     * Aba aberta desde antes do deploy. O aceite dela e de um texto que nao e
     * mais o texto, e a resposta diz qual e a versao vigente para o front
     * recarregar o documento.
     */
    it('teste-trava: versao velha e 409, e nada e gravado', async () => {
      const { token, uid } = await createRawSession();

      const response = await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'termos-de-uso', version: '2020-01-01' })
        .expect(409);

      expect(response.body).toMatchObject({
        error: 'stale_version',
        current: '2026-08-27',
      });

      const acceptances = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
        .listDocuments();
      expect(acceptances).toHaveLength(0);
    });

    it('aceite repetido e 204 e NAO reescreve a data original', async () => {
      const { token, uid } = await createRawSession();
      const path = firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
        .doc('termos-de-uso__2026-08-27');

      await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'termos-de-uso', version: '2026-08-27' })
        .expect(204);

      const primeira = (await path.get()).data()?.acceptedAt as unknown;

      await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'termos-de-uso', version: '2026-08-27' })
        .expect(204);

      // Aquela data e a unica prova que vai existir de quando a pessoa
      // concordou. Reescreve-la seria apaga-la.
      expect((await path.get()).data()?.acceptedAt).toEqual(primeira);
    });

    it('documento inexistente e 404', async () => {
      const { token } = await createRawSession();

      await request(app.getHttpServer())
        .post('/me/legal-acceptances')
        .set('Authorization', `Bearer ${token}`)
        .send({ documentId: 'contrato-inexistente', version: '2026-08-27' })
        .expect(404);
    });
  });

  describe('a trava do onboarding', () => {
    /**
     * **O caso que faz o bloqueio do onboarding e o do membro antigo serem a
     * mesma regra.** `PATCH /me/profile` e o endpoint que carimba `completedAt`,
     * e ele nao esta na lista de isencoes do guard: quem nao aceitou nao conclui
     * o cadastro, e nao ha um segundo `if` dentro do `ProfileService` sustentando
     * isso.
     */
    it('teste-trava: PATCH /me/profile antes dos aceites e 428, e completedAt continua nulo', async () => {
      const { token, uid } = await createRawSession();

      await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Uma bio suficientemente longa para passar.',
        })
        .expect(428);

      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .get();
      expect(perfil.data()?.completedAt ?? null).toBeNull();

      await acceptCurrentLegalDocuments(app.getHttpServer(), token);

      const depois = await request(app.getHttpServer())
        .patch('/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Fulano de Tal',
          phone: '47999990000',
          bio: 'Uma bio suficientemente longa para passar.',
        })
        .expect(200);

      const dto = depois.body as ProfileDto;
      expect(dto.profileCompleted).toBe(true);
      expect(dto.pendingLegal).toEqual([]);
      expect(dto.legalAcceptances['termos-de-uso'].version).toBe('2026-08-27');
    });
  });

  describe('exclusao de conta', () => {
    /**
     * Terceira subcolecao do produto, e a terceira vez que ela precisa ser
     * apagada explicitamente: subcolecao nao some com o pai no Firestore.
     */
    it('teste-trava: apagar a conta apaga a subcolecao de aceites', async () => {
      const { token, uid } = await createRawSession();
      await acceptCurrentLegalDocuments(app.getHttpServer(), token);

      const antes = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
        .listDocuments();
      expect(antes).toHaveLength(2);

      await request(app.getHttpServer())
        .delete('/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: SENHA })
        .expect(204);

      const depois = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .collection(LEGAL_ACCEPTANCE_SUBCOLLECTION)
        .listDocuments();
      expect(depois).toHaveLength(0);
    });
  });
});
