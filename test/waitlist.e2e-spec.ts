import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('WaitlistController (e2e)', () => {
  let app: INestApplication;
  let firstId: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const uniqueEmail = `test-${Date.now()}@test.com`;

  it('/waitlist (POST) - should create entry and return receipt', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        name: 'Test Name',
        phone: '11999998888',
        email: uniqueEmail,
        consent: true,
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body).toHaveProperty('receivedAt');
    firstId = (response.body as { id: string }).id;
  });

  it('/waitlist (POST) - should return 400 for invalid body', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        name: 'T', // too short
        phone: '123', // invalid phone
        email: 'invalid-email',
        consent: false, // invalid consent
      })
      .expect(400);
  });

  it('/waitlist (POST) - should return existing receipt for same email', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await request(app.getHttpServer())
      .post('/waitlist')
      .send({
        name: 'Test Name 2',
        phone: '11999998888',
        email: uniqueEmail,
        consent: true,
      })
      .expect(201);

    expect((response.body as { id: string }).id).toEqual(firstId);
  });
});
