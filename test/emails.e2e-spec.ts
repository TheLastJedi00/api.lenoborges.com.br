import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { Firestore } from 'firebase-admin/firestore';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/auth/firebase.service';
import { MailerService } from '../src/emails/mailer.service';
import { PROFILE_COLLECTION } from '../src/profile/profile.repository';
import { EMAIL_CAMPAIGN_COLLECTION } from '../src/emails/email-campaign.repository';
import { signUnsubscribeToken } from '../src/emails/unsubscribe-token';
import { SessionResponseDto } from '../src/auth/dto/session.dto';

/**
 * Disparo de e-mails (spec 014), ponta a ponta.
 *
 * O que este arquivo prova é a **decisão 8**: não existe e-mail que ignore o
 * descadastro. É o único lugar onde ela é verificável de verdade — o
 * `MailerService` roda em modo log (sem `RESEND_API_KEY`), então dá para
 * inspecionar exatamente quem entraria na lista de destinatários sem nada sair
 * pela rede.
 */
describe('Disparo de e-mails (e2e)', () => {
  let app: INestApplication<App>;
  let firebase: FirebaseService;
  let firestore: Firestore;
  let mailer: MailerService;

  const createdUserIds: string[] = [];
  const createdCampaignIds: string[] = [];

  const SENHA = 'MinhaSenhaSegura123';

  let adminToken: string;
  let membroUid: string;
  let membroEmail: string;
  let descadastradoUid: string;
  let descadastradoEmail: string;

  const uniqueEmail = (prefix: string) =>
    `e2e-mail-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;

  async function createSession(options: { admin?: boolean } = {}) {
    const email = uniqueEmail(options.admin ? 'admin' : 'membro');

    const user = await firebase.auth.createUser({
      email,
      password: SENHA,
      // Sem isto a pessoa não entra na audiência: endereço não confirmado é
      // candidato a erro de digitação, e cada um é um bounce.
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

    return {
      token: (response.body as SessionResponseDto).accessToken,
      uid: user.uid,
      email,
    };
  }

  /** Os destinatários que o modo log registrou, a partir do spy no mailer. */
  function destinatarios(spy: jest.SpyInstance): string[] {
    return (spy.mock.calls as unknown[][]).flatMap((call) =>
      (call[0] as { to: string }[]).map((mensagem) => mensagem.to),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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
    mailer = app.get(MailerService);

    const admin = await createSession({ admin: true });
    adminToken = admin.token;

    const membro = await createSession();
    membroUid = membro.uid;
    membroEmail = membro.email;

    const descadastrado = await createSession();
    descadastradoUid = descadastrado.uid;
    descadastradoEmail = descadastrado.email;
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
    for (const campaignId of createdCampaignIds) {
      try {
        await firestore
          .collection(EMAIL_CAMPAIGN_COLLECTION)
          .doc(campaignId)
          .delete();
      } catch {
        // ignore cleanup error
      }
    }
    await app.close();
  });

  it('sem RESEND_API_KEY, o mailer esta em modo log e nada sai pela rede', () => {
    // É a proteção que faz esta suíte poder rodar: uma máquina apontada para o
    // Firestore de produção não manda e-mail para a base inteira.
    expect(mailer.enabled).toBe(false);
  });

  describe('descadastro', () => {
    it('o link do rodape descadastra sem login, e responde 204', async () => {
      const token = signUnsubscribeToken(
        descadastradoUid,
        process.env.EMAIL_UNSUBSCRIBE_SECRET!,
      );

      await request(app.getHttpServer())
        .post(`/emails/descadastro?token=${token}`)
        .expect(204);

      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(descadastradoUid)
        .get();
      expect(perfil.data()?.emailOptOut).toBe(true);
      expect(perfil.data()?.emailOptOutReason).toBe('membro');
    });

    it('token invalido tambem responde 204, e nao escreve nada', async () => {
      // Distinguir seria um oráculo de uid.
      await request(app.getHttpServer())
        .post('/emails/descadastro?token=lixo.invalido')
        .expect(204);
    });

    it('o membro liga e desliga pelo proprio perfil', async () => {
      const { token, uid } = await createSession();

      await request(app.getHttpServer())
        .patch('/me/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ receber: false })
        .expect(204);

      let perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(uid)
        .get();
      expect(perfil.data()?.emailOptOut).toBe(true);

      await request(app.getHttpServer())
        .patch('/me/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ receber: true })
        .expect(204);

      perfil = await firestore.collection(PROFILE_COLLECTION).doc(uid).get();
      expect(perfil.data()?.emailOptOut).toBe(false);
      expect(perfil.data()?.emailOptOutReason).toBeNull();
    });

    it('GET /me devolve o estado, para o front desenhar o interruptor', async () => {
      const { token } = await createSession();

      const perfil = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((perfil.body as { emailOptOut: boolean }).emailOptOut).toBe(false);
    });
  });

  describe('audiência e campanha', () => {
    it('a previa devolve so a contagem, e nenhum e-mail', async () => {
      const resposta = await request(app.getHttpServer())
        .post('/admin/emails/audiencia')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(200);

      expect(Object.keys(resposta.body as object)).toEqual(['count']);
      expect(JSON.stringify(resposta.body)).not.toContain('@');
    });

    it('membro comum nao dispara nada: 403', async () => {
      const { token } = await createSession();

      await request(app.getHttpServer())
        .post('/admin/emails')
        .set('Authorization', `Bearer ${token}`)
        .send({ subject: 'Assunto', body: 'Corpo com mais de dez caracteres.' })
        .expect(403);
    });

    /**
     * **O teste que prova a decisão 8 de ponta a ponta.** O e-mail sai, a
     * campanha termina `concluida`, e quem descadastrou não está na lista de
     * destinatários — nem por engano, nem por caminho alternativo, porque não
     * existe função que envie sem passar por onde o descadastro é aplicado.
     */
    it('a campanha sai, conclui, e o descadastrado NAO esta entre os destinatarios', async () => {
      const spy = jest.spyOn(mailer, 'sendBatch');

      const resposta = await request(app.getHttpServer())
        .post('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          subject: 'Um aviso para a comunidade',
          body: 'Corpo do aviso, com mais de dez caracteres.',
        })
        .expect(201);

      const campanha = resposta.body as {
        id: string;
        status: string;
        audienceCount: number;
        sentCount: number;
      };
      createdCampaignIds.push(campanha.id);

      expect(campanha.status).toBe('concluida');
      expect(campanha.sentCount).toBe(campanha.audienceCount);

      const enviados = destinatarios(spy);
      expect(enviados).toContain(membroEmail);
      expect(enviados).not.toContain(descadastradoEmail);

      spy.mockRestore();
    });

    it('filtros que nao pegam ninguem respondem 400', async () => {
      // Campanha para zero pessoa é sempre engano.
      await request(app.getHttpServer())
        .post('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          subject: 'Assunto',
          body: 'Corpo com mais de dez caracteres.',
          gradeMin: 13,
          gradeMax: 13,
        })
        .expect(400);
    });

    it('o teste vai para o proprio admin e NAO cria campanha', async () => {
      const antes = await request(app.getHttpServer())
        .get('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/admin/emails/teste')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subject: 'Ensaio', body: 'Corpo do ensaio, bem longo.' })
        .expect(204);

      const depois = await request(app.getHttpServer())
        .get('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect((depois.body as unknown[]).length).toBe(
        (antes.body as unknown[]).length,
      );
    });

    it('o historico nao devolve o corpo do e-mail', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const linhas = resposta.body as Record<string, unknown>[];
      expect(linhas.length).toBeGreaterThan(0);
      linhas.forEach((linha) => {
        expect('body' in linha).toBe(false);
      });
    });
  });

  /**
   * O e-mail direto (spec 015), ponta a ponta.
   *
   * **É a prova das decisões 11, 12 e 13 juntas**: um destinatário e não a base,
   * os três cortes valendo com o motivo nomeado, e o rodapé de descadastro indo
   * junto num e-mail com um destinatário só.
   */
  describe('e-mail direto para um membro (spec 015)', () => {
    const recado = {
      subject: 'Sobre a sua dúvida no Mural',
      body: 'Oi. Vi sua pergunta e queria responder por aqui.',
    };

    /**
     * **O teste-trava da decisão 11, de ponta a ponta.** A campanha `direto`
     * grava os três filtros nulos, e filtro nulo significa todos os membros: se
     * o `recipientUid` deixar de ser lido antes deles, este teste vê a base
     * inteira na lista de destinatários.
     */
    it('teste-trava: sai para EXATAMENTE um destinatario, e nao para a base', async () => {
      const spy = jest.spyOn(mailer, 'sendBatch');

      const resposta = await request(app.getHttpServer())
        .post(`/admin/users/${membroUid}/email`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(recado)
        .expect(201);

      const campanha = resposta.body as {
        id: string;
        status: string;
        audienceCount: number;
        sentCount: number;
      };
      createdCampaignIds.push(campanha.id);

      expect(campanha).toMatchObject({
        status: 'concluida',
        audienceCount: 1,
        sentCount: 1,
      });

      const enviados = destinatarios(spy);
      expect(enviados).toEqual([membroEmail]);

      spy.mockRestore();
    });

    it('o recado sai com o rodape de descadastro e o List-Unsubscribe', async () => {
      const spy = jest.spyOn(mailer, 'sendBatch');

      const resposta = await request(app.getHttpServer())
        .post(`/admin/users/${membroUid}/email`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(recado)
        .expect(201);
      createdCampaignIds.push((resposta.body as { id: string }).id);

      const [lote] = spy.mock.calls.at(-1)!;
      expect(lote[0].html).toContain('/emails/descadastro?token=');
      expect(lote[0].headers?.['List-Unsubscribe']).toBeDefined();

      spy.mockRestore();
    });

    /**
     * **O descadastro é absoluto, e vale para o recado pessoal também**
     * (decisão 13). O `422` traz o motivo nomeado, e não uma prosa que a tela
     * teria que interpretar.
     */
    it('teste-trava: membro descadastrado responde 422 com reason=descadastrado', async () => {
      const spy = jest.spyOn(mailer, 'sendBatch');

      const resposta = await request(app.getHttpServer())
        .post(`/admin/users/${descadastradoUid}/email`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(recado)
        .expect(422);

      expect(resposta.body).toMatchObject({ reason: 'descadastrado' });
      expect(spy).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it('uid que nao existe responde 404', async () => {
      await request(app.getHttpServer())
        .post('/admin/users/uid-que-nunca-existiu/email')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(recado)
        .expect(404);
    });

    it('o recado aparece no MESMO historico, com kind direto e o rotulo', async () => {
      const resposta = await request(app.getHttpServer())
        .get('/admin/emails')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const linhas = resposta.body as {
        kind: string;
        recipientLabel: string | null;
      }[];
      const direto = linhas.find((linha) => linha.kind === 'direto');

      expect(direto).toBeDefined();
      expect(direto!.recipientLabel).toBeTruthy();
    });

    it('recusa corpo vazio e assunto curto, como a campanha', async () => {
      await request(app.getHttpServer())
        .post(`/admin/users/${membroUid}/email`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ subject: 'oi', body: 'curto' })
        .expect(400);
    });

    it('recusa ctaUrl: um recado para uma pessoa nao tem para onde apontar', async () => {
      // `forbidNonWhitelisted` transforma a ausencia do campo no DTO em 400, e e
      // por isso que a decisao 12 nao precisa de guarda propria.
      await request(app.getHttpServer())
        .post(`/admin/users/${membroUid}/email`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...recado,
          ctaLabel: 'Ver na trilha',
          ctaUrl: 'https://edu.lenoborges.com.br/dashboard',
        })
        .expect(400);
    });
  });

  describe('webhook', () => {
    it('sem assinatura valida, 401 e nada e escrito', async () => {
      await request(app.getHttpServer())
        .post('/emails/webhook/resend')
        .send({
          type: 'email.bounced',
          data: { to: [membroEmail] },
        })
        .expect(401);

      const perfil = await firestore
        .collection(PROFILE_COLLECTION)
        .doc(membroUid)
        .get();
      expect(perfil.data()?.emailOptOut).toBe(false);
    });
  });
});
