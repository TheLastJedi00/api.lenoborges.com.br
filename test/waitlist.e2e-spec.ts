import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { WaitlistEntry } from './../src/waitlist/entities/waitlist-entry.entity';

// Esta suite roda contra o banco apontado por DATABASE_URL, que hoje e o projeto
// real do Supabase. Tudo que ela grava e removido no afterAll: sem isso, cada
// execucao (inclusive em CI) deixaria uma inscricao de teste permanente na lista.
describe('WaitlistController (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

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
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized && createdEmails.length > 0) {
      await dataSource
        .getRepository(WaitlistEntry)
        .delete({ email: In(createdEmails) });
    }
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
