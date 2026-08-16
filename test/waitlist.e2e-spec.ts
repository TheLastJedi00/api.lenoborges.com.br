import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FirebaseService } from './../src/auth/firebase.service';
import { WAITLIST_COLLECTION } from './../src/waitlist/waitlist.repository';

// Esta suite roda contra o emulador do Firestore, nao contra um projeto real:
// `npm run emulators` sobe Auth e Firestore locais, e FIRESTORE_EMULATOR_HOST
// redireciona o Admin SDK para la.
//
// A limpeza do afterAll continua mesmo assim. O emulador e descartavel, mas quem
// rodar a suite com a variavel apontando para um projeto de verdade -- por
// engano ou por escolha -- nao pode deixar inscricao de teste na lista real.
describe('WaitlistController (e2e)', () => {
  let app: INestApplication<App>;
  let firestore: Firestore;

  // Registrado a cada requisicao aceita, para a limpeza nao depender de os
  // testes terem passado.
  const createdEmails: string[] = [];

  const uniqueEmail = () => {
    const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    firestore = app.get(FirebaseService).firestore;
  });

  afterAll(async () => {
    // O e-mail normalizado E o ID do documento desde a spec 007, entao a limpeza
    // e por caminho: sem consulta, sem indice, sem risco de apagar o que nao foi
    // criado aqui.
    await Promise.all(
      createdEmails.map((email) =>
        firestore.collection(WAITLIST_COLLECTION).doc(email).delete(),
      ),
    );
    await app.close();
  });

  it('cria a inscricao e devolve o recibo', async () => {
    const response = await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        name: 'Test Name',
        phone: '11999998888',
        email: uniqueEmail(),
        consent: true,
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('receivedAt');
  });

  it('devolve o recibo original quando o e-mail se repete', async () => {
    // As duas requisicoes vivem no mesmo teste: com o id vindo de outro teste,
    // rodar este isolado compararia contra undefined e a falha seria enganosa.
    const email = uniqueEmail();

    const first = await request(app.getHttpServer())
      .post('/waitlist')
      .send({ name: 'Test Name', phone: '11999998888', email, consent: true })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/waitlist')
      .send({ name: 'Outro Nome', phone: '11888887777', email, consent: true })
      .expect(201);

    const firstBody = first.body as { id: string; receivedAt: string };
    const secondBody = second.body as { id: string; receivedAt: string };

    expect(secondBody.id).toEqual(firstBody.id);
    expect(secondBody.receivedAt).toEqual(firstBody.receivedAt);
  });

  it('recusa corpo invalido com 400', async () => {
    await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        name: 'T', // curto demais
        phone: '123', // telefone invalido
        email: 'invalid-email',
        consent: false, // consentimento ausente
      })
      .expect(400);
  });
});
