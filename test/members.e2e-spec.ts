import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { acceptCurrentLegalDocuments } from './accept-legal.helper';
import { AppModule } from '../src/app.module';
import { StorageService } from '../src/storage/storage.service';
import { FirebaseService } from '../src/auth/firebase.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { SessionResponseDto } from '../src/auth/dto/session.dto';
import { PublicMemberDto } from '../src/profile/dto/public-member.dto';

/**
 * O cartao do membro contra o emulador (spec 019).
 *
 * O caso que mais importa e o **vazamento**: a resposta tem sete campos e
 * nenhum a mais, com o interruptor ligado ou desligado. E o teste que fica
 * vermelho no dia em que alguem montar este DTO por espalhamento de objeto.
 */
describe('Cartao do membro (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;

  const createdUserIds: string[] = [];

  let anaToken: string;
  let anaUid: string;
  let brunoToken: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createMember(
    prefix: string,
  ): Promise<{ token: string; uid: string }> {
    const email = uniqueEmail(prefix);
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
    await acceptCurrentLegalDocuments(app.getHttpServer(), token);

    // O onboarding: sem `completedAt` o cartao e 404, e e proposital.
    await request(app.getHttpServer())
      .patch('/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `${prefix} Prado`,
        phone: '47999990000',
        bio: 'Migrando de suporte para desenvolvimento.',
        linkedin: 'https://www.linkedin.com/in/ana-prado',
        instagram: 'https://www.instagram.com/anaprado',
      })
      .expect(200);

    return { token, uid: user.uid };
  }

  const PNG_MINIMO = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);

  async function abrirCartao(uid: string): Promise<PublicMemberDto> {
    const response = await request(app.getHttpServer())
      .get(`/members/${uid}`)
      .set('Authorization', `Bearer ${brunoToken}`)
      .expect(200);

    return response.body as PublicMemberDto;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // O emulador de Storage nao entra nesta spec; ver a nota em `me.e2e-spec.ts`.
      .overrideProvider(StorageService)
      .useValue({
        upload: (path: string) =>
          Promise.resolve(
            `https://storage.googleapis.com/bucket-de-teste/${path}?v=1757000000000`,
          ),
        remove: () => Promise.resolve(),
        isOwnUrl: () => true,
      })
      .compile();

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

    const ana = await createMember('ana');
    anaToken = ana.token;
    anaUid = ana.uid;

    const bruno = await createMember('bruno');
    brunoToken = bruno.token;
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

  it('sem sessao, 401: o cartao nao e publico', async () => {
    await request(app.getHttpServer()).get(`/members/${anaUid}`).expect(401);
  });

  /**
   * O padrao e invisivel (decisao 9): quem preencheu o LinkedIn o preencheu num
   * formulario que so a administracao lia.
   */
  it('as redes nascem escondidas para os outros membros', async () => {
    const cartao = await abrirCartao(anaUid);

    expect(cartao.linkedin).toBeNull();
    expect(cartao.instagram).toBeNull();
    expect(cartao.name).toContain('Prado');
  });

  it('o interruptor liga, e o cartao passa a traze-las', async () => {
    await request(app.getHttpServer())
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${anaToken}`)
      .send({ socialLinksPublic: true })
      .expect(204);

    const cartao = await abrirCartao(anaUid);

    expect(cartao.linkedin).toBe('https://www.linkedin.com/in/ana-prado');
    expect(cartao.instagram).toBe('https://www.instagram.com/anaprado');
  });

  /**
   * **O teste de vazamento.** Igualdade de conjunto, e nao `toMatchObject` --
   * aquele passa feliz quando um campo a mais aparece.
   */
  it('teste-trava: a resposta tem exatamente sete campos, nos dois estados', async () => {
    const chaves = [
      'bio',
      'grade',
      'id',
      'instagram',
      'linkedin',
      'name',
      'xp',
    ];

    await request(app.getHttpServer())
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${anaToken}`)
      .send({ socialLinksPublic: false })
      .expect(204);
    expect(Object.keys(await abrirCartao(anaUid)).sort()).toEqual(chaves);

    await request(app.getHttpServer())
      .patch('/me/privacy')
      .set('Authorization', `Bearer ${anaToken}`)
      .send({ socialLinksPublic: true })
      .expect(204);
    expect(Object.keys(await abrirCartao(anaUid)).sort()).toEqual(chaves);
  });

  it('teste-trava: nunca traz e-mail, telefone nem tier', async () => {
    const cartao = (await abrirCartao(anaUid)) as unknown as Record<
      string,
      unknown
    >;

    expect(cartao.email).toBeUndefined();
    expect(cartao.phone).toBeUndefined();
    expect(cartao.tier).toBeUndefined();
    expect(cartao.role).toBeUndefined();
    expect(cartao.emailOptOut).toBeUndefined();
  });

  /**
   * Conta pela metade nao tem nome nem bio: um cartao dela seria um cartao
   * vazio, e 200 com nada e pior do que 404. De quebra, fecha a enumeracao de
   * contas em criacao.
   */
  it('onboarding incompleto responde 404', async () => {
    const email = uniqueEmail('incompleto');
    const user = await firebase.auth.createUser({
      email,
      password: 'MinhaSenhaSegura123',
      emailVerified: true,
    });
    createdUserIds.push(user.uid);

    await request(app.getHttpServer())
      .get(`/members/${user.uid}`)
      .set('Authorization', `Bearer ${brunoToken}`)
      .expect(404);
  });

  it('uid inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .get('/members/uid-que-nunca-existiu')
      .set('Authorization', `Bearer ${brunoToken}`)
      .expect(404);
  });

  describe('a foto no cartao publico (spec 027)', () => {
    it('a foto aparece no cartao mesmo com as redes escondidas', async () => {
      // **A assimetria e deliberada** (spec 027): o `socialLinksPublic` governa
      // vinculo a conta de fora, e a foto ja esta no placar, que e tela aberta a
      // toda a liga. Esconder no cartao o que o ranking mostra tres linhas acima
      // nao protegeria nada.
      const ana = await createMember('ana-foto');

      const enviado = await request(app.getHttpServer())
        .post('/me/avatar')
        .set('Authorization', `Bearer ${ana.token}`)
        .attach('file', PNG_MINIMO, {
          filename: 'ana.png',
          contentType: 'image/png',
        })
        .expect(201);

      const cartao = await abrirCartao(ana.uid);

      expect(cartao.avatarUrl).toBe(
        (enviado.body as { avatarUrl: string }).avatarUrl,
      );
      // O interruptor nasce desligado, entao as redes saem nulas na mesma resposta.
      expect(cartao.linkedin).toBeNull();
      expect(cartao.instagram).toBeNull();
    });

    it('quem nao tem foto devolve avatarUrl nulo, e nao o campo ausente', async () => {
      const semFoto = await createMember('sem-foto');

      const cartao = await abrirCartao(semFoto.uid);

      expect(cartao.avatarUrl).toBeNull();
    });
  });
});
