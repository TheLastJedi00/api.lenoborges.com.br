import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // O corpo cru, para a assinatura do webhook do provedor de e-mail poder ser
    // conferida (spec 014). Assinatura calculada sobre JSON ja parseado e
    // reserializado nao confere -- a ordem das chaves e os espacos mudam --, e o
    // sintoma e "o webhook nunca valida", sem nenhuma pista do motivo.
    //
    // O Nest guarda o cru **alem** do parseado, entao nada muda para as outras
    // rotas: `@Body()` continua recebendo o objeto.
    rawBody: true,
  });
  const configService = app.get(ConfigService);

  app.use(cookieParser());

  // O limite por IP do ThrottlerGuard e o unico controle de abuso do endpoint
  // publico, e ele passa a ler o IP do X-Forwarded-For. O numero de hops precisa
  // bater com a topologia real: se for maior que a quantidade de proxies na
  // frente, ou se o container for alcancavel direto, da para forjar o cabecalho
  // e furar o limite. Configuravel por TRUST_PROXY_HOPS.
  const trustProxyHops = Number(
    configService.get<string>('TRUST_PROXY_HOPS') ?? 1,
  );
  app.set('trust proxy', trustProxyHops);

  const frontendUrl = configService.get<string>('FRONTEND_URL') || '';
  const allowedOrigins = frontendUrl.split(',').map((url) => url.trim());

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS', 'PUT', 'DELETE'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // O SwaggerModule registra rotas direto no Express, fora do pipeline de guards
  // do Nest, entao o ThrottlerGuard nao cobre /docs. Sem auth, publicar o schema
  // completo em producao entrega o mapa da API de graca: fica desligado la, e
  // SWAGGER_ENABLED=true e o opt-in explicito para quando houver protecao.
  const isProduction = configService.get<string>('NODE_ENV') === 'production';
  const swaggerEnabled =
    configService.get<string>('SWAGGER_ENABLED') === 'true' || !isProduction;

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Eduleno API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, documentFactory);
  }

  const port = configService.get<number>('PORT') ?? 3000;

  // O init monta o pipeline sem abrir socket, que e o que o handler serverless
  // precisa. Quem escuta a porta e o bloco no fim do arquivo.
  await app.init();

  return { app, port };
}

const bootstrapPromise = bootstrap();

// A Vercel nao mantem um processo escutando porta: ela importa este modulo e
// espera um handler exportado ("No exports found in module .../main.js. Did you
// forget to export a function or a server?"). O handler repassa a requisicao
// para o mesmo Express que o Nest ja usa por baixo, e a promise garante que o
// bootstrap rode uma vez so, reaproveitado entre invocacoes na mesma instancia.
export default async function handler(req: Request, res: Response) {
  const { app } = await bootstrapPromise;
  app.getHttpAdapter().getInstance()(req, res);
}

// Fora da Vercel (start:dev, start:prod, e2e) nada muda: o processo escuta a
// porta como antes.
if (!process.env.VERCEL) {
  void bootstrapPromise.then(({ app, port }) => app.listen(port));
}
