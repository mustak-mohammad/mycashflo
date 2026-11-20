import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
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

  // Security Headers Middleware (SEC-CSRF-001: defense-in-depth against MIME sniffing, clickjacking & framing)
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    next();
  });

  // Global JSON and URL-encoded limit restricted to 1MB to prevent DoS memory exhaustion (SEC-INPUT-001)
  // Preserve raw request body buffer for cryptographic webhook signature verification (e.g. Stripe, Razorpay)
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // CORS — validate allowed origins and protect against cross-site exploitation (SEC-CSRF-001)
  const rawWebOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173';
  const allowedOrigins = rawWebOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile clients, curl, server-to-server) or matching allowed list
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost:'))
      ) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: Origin ${origin} not allowed`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: [
      'Content-Disposition',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
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

  // Graceful shutdown hooks for persistent Node.js service (SIGTERM / SIGINT)
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 myCashflo API running on http://0.0.0.0:${port}/api`, 'Bootstrap');
  Logger.log(`📖 Swagger docs available at http://0.0.0.0:${port}/api/docs`, 'Bootstrap');
}

await bootstrap();
