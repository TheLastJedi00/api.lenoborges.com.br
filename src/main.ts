import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
  await app.listen(port);
}
void bootstrap();
