import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { AdminUserPageDto } from '../src/admin/dto/admin-user-page.dto';

describe('Administração de usuários (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];
  let adminToken: string;
  let memberToken: string;
  let memberId: string;
  let semPerfilId: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

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

    adminToken = (await createSession(true)).token;
    const member = await createSession(false);
    memberToken = member.token;
    memberId = member.uid;

    // Um usuário que existe no Auth e NUNCA teve perfil: quem se cadastrou e
    // parou. Ele é o caso que a decisão 10 protege.
    const semPerfil = await firebase.auth.createUser({
      email: uniqueEmail('sem-perfil'),
      password: 'MinhaSenhaSegura123',
    });
    semPerfilId = semPerfil.uid;
    createdUserIds.push(semPerfilId);
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
    await app.close();
  });

  it('membro comum recebe 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('sem token responde 401', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });

  it('admin lista os usuários cadastrados', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/users?limit=1000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const page = response.body as AdminUserPageDto;
    expect(page.users.some((user) => user.id === memberId)).toBe(true);
  });

  /**
   * O teste que sustenta a decisão 10: a listagem é paginada pelo Auth, então
   * quem nunca criou perfil continua visível — com os campos nulos, que é
   * informação, e não ausência de dado.
   */
  it('usuário sem perfil aparece com os campos de perfil nulos', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/users?limit=1000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const page = response.body as AdminUserPageDto;
    const semPerfil = page.users.find((user) => user.id === semPerfilId);

    expect(semPerfil).toBeDefined();
    expect(semPerfil).toMatchObject({
      name: null,
      grade: null,
      profileCompleted: false,
    });
  });

  it('admin altera o grade de um membro', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: 7 })
      .expect(204);

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect((me.body as { grade: number }).grade).toBe(7);
  });

  /**
   * tier nao e claim: ele vale na hora, sem esperar token novo. Este teste e o
   * que denuncia alguem transforma-lo em custom claim "por simetria com role" --
   * o membro que acabou de pagar ficaria ate uma hora sem acesso.
   */
  it('admin altera o tier, e o efeito vale na sessao atual', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tier: 'great-dev-tier' })
      .expect(204);

    const me = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect((me.body as { tier: string }).tier).toBe('great-dev-tier');
    // E o grade nao se mexeu junto.
    expect((me.body as { grade: number }).grade).toBe(7);
  });

  it('recusa tier que nao existe', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tier: 'plus-dev-tier' })
      .expect(400);
  });

  it('recusa grade fora da faixa 0..13', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/users/${memberId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ grade: 33 })
      .expect(400);
  });

  /**
   * **O único lugar onde a decisão 1 da spec 015 é verificável de ponta a
   * ponta**: o recorte acontece sobre a base inteira, e não sobre uma página.
   */
  describe('encontrar um membro (spec 015)', () => {
    /** Um sobrenome improvável, para o recorte não pegar carona em outro teste. */
    const sobrenome = `Zeferino${Date.now()}`;
    let buscavelId: string;

    beforeAll(async () => {
      const buscavel = await firebase.auth.createUser({
        email: uniqueEmail('buscavel'),
        password: 'MinhaSenhaSegura123',
        emailVerified: true,
      });
      buscavelId = buscavel.uid;
      createdUserIds.push(buscavelId);

      await firestore
        .collection(PROFILE_COLLECTION)
        .doc(buscavelId)
        .set({
          name: `José da Silva ${sobrenome}`,
          phone: '47999990000',
          bio: null,
          grade: 5,
          tier: 'ultra-dev-tier',
          linkedin: null,
          instagram: null,
          emailOptOut: false,
          emailOptOutReason: null,
          emailOptOutAt: null,
          completedAt: new Date(),
          waitlistEntryId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    });

    async function listar(query: string): Promise<AdminUserPageDto> {
      const response = await request(app.getHttpServer())
        .get(`/admin/users${query}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      return response.body as AdminUserPageDto;
    }

    it('a busca acha pelo MEIO da string, e sem acento', async () => {
      // Prefixo nao serve: quem procura pelo sobrenome digita o meio.
      const pagina = await listar(`?q=${sobrenome.slice(2).toLowerCase()}`);

      expect(pagina.users.map((u) => u.id)).toContain(buscavelId);
    });

    it('a busca acha "José" digitando "jose"', async () => {
      const pagina = await listar('?q=jose%20da%20silva');

      expect(pagina.users.map((u) => u.id)).toContain(buscavelId);
    });

    /**
     * **A pessoa que a spec inteira existe para achar.** Ela não tem documento
     * em `profiles`: procurá-la por consulta ao Firestore seria procurá-la
     * exatamente onde ela não está.
     */
    it('onboarding pendente traz quem NAO tem documento de perfil', async () => {
      const pagina = await listar('?onboarding=pendente&limit=200');

      expect(pagina.users.map((u) => u.id)).toContain(semPerfilId);
      expect(pagina.users.map((u) => u.id)).not.toContain(buscavelId);
    });

    it('total e do RECORTE, e nao da base', async () => {
      const semFiltro = await listar('?limit=1');
      const comFiltro = await listar(`?q=${sobrenome.toLowerCase()}&limit=1`);

      expect(comFiltro.total).toBe(1);
      expect(semFiltro.total).toBeGreaterThan(comFiltro.total);
      // E o `total` nao e o tamanho da pagina: com limit=1 ele continua contando
      // o recorte inteiro.
      expect(semFiltro.users).toHaveLength(1);
    });

    it('offset devolve a segunda pagina do RECORTE', async () => {
      const primeira = await listar('?limit=1&offset=0');
      const segunda = await listar('?limit=1&offset=1');

      expect(segunda.offset).toBe(1);
      expect(segunda.users[0]?.id).not.toBe(primeira.users[0]?.id);
    });

    it('filtro por tier e por faixa de insignia recorta a base inteira', async () => {
      const pagina = await listar(
        '?tiers=ultra-dev-tier&gradeMin=5&gradeMax=5&limit=200',
      );

      expect(pagina.users.map((u) => u.id)).toContain(buscavelId);
      expect(pagina.users.map((u) => u.id)).not.toContain(semPerfilId);
    });

    it('faixa invertida responde 400, e nao um recorte vazio em silencio', async () => {
      await request(app.getHttpServer())
        .get('/admin/users?gradeMin=8&gradeMax=3')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('teste-trava: nenhum telefone na resposta da listagem', async () => {
      const pagina = await listar('?limit=200');

      expect(JSON.stringify(pagina)).not.toContain('47999990000');
    });

    it('o detalhe traz o telefone, e o tier sai na linha', async () => {
      const pagina = await listar(`?q=${sobrenome.toLowerCase()}`);
      expect(pagina.users[0].tier).toBe('ultra-dev-tier');

      const detalhe = await request(app.getHttpServer())
        .get(`/admin/users/${buscavelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(detalhe.body).toMatchObject({
        phone: '47999990000',
        tier: 'ultra-dev-tier',
        canReceiveEmail: true,
        cannotReceiveReason: null,
      });
    });

    it('membro sem perfil responde 200 no detalhe, e nunca 404', async () => {
      const detalhe = await request(app.getHttpServer())
        .get(`/admin/users/${semPerfilId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(detalhe.body).toMatchObject({
        name: null,
        phone: null,
        tier: null,
        profileCompleted: false,
      });
    });

    it('uid que nao existe responde 404', async () => {
      await request(app.getHttpServer())
        .get('/admin/users/uid-que-nunca-existiu')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('membro comum recebe 403 no detalhe e no e-mail direto', async () => {
      await request(app.getHttpServer())
        .get(`/admin/users/${buscavelId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/admin/users/${buscavelId}/email`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ subject: 'Assunto', body: 'Corpo com mais de dez.' })
        .expect(403);
    });
  });
});
