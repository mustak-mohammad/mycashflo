import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT') ?? 3000;
  const webOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173';

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS — only allow the React dev server in development
  app.enableCors({
    origin: webOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Global validation pipe (class-validator DTOs)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,       // auto-transform query params to their declared types
    }),
  );

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('myCashflo API')
    .setDescription('AI-powered collections and receivables management REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  Logger.log(`🚀 myCashflo API running on http://localhost:${port}/api`, 'Bootstrap');
  Logger.log(`📖 Swagger docs available at http://localhost:${port}/api/docs`, 'Bootstrap');
}

await bootstrap();
