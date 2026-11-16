import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { DocumentDeliveryService } from './document-delivery.service.js';
import { JwtStrategy } from '../auth/jwt.strategy.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('VoiceController — GET /voice/synthesize Authentication', () => {
  const TEST_SECRET = 'test_jwt_access_secret_for_voice_synthesize_spec';
  let app: INestApplication;
  let jwtService: JwtService;
  let mockVoiceService: { synthesizeSpeech: ReturnType<typeof vi.fn> };
  let mockPrisma: { user: { findUnique: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    mockVoiceService = {
      synthesizeSpeech: vi.fn().mockResolvedValue(Buffer.from('ID3_AUDIO_BYTES')),
    };
    mockPrisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-agent-1',
          role: 'AGENT',
          tenantId: 'tenant-1',
          isActive: true,
          tokensValidAfter: null,
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: TEST_SECRET }),
      ],
      controllers: [VoiceController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        { provide: VoiceService, useValue: mockVoiceService },
        { provide: DocumentDeliveryService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return TEST_SECRET;
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwtService = moduleRef.get(JwtService);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('decorates synthesizeSpeech route handler with JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      VoiceController.prototype.synthesizeSpeech,
    );
    expect(Array.isArray(guards)).toBe(true);
    expect(guards).toContain(JwtAuthGuard);
  });

  it('rejects unauthenticated GET /voice/synthesize requests with 401 Unauthorized', async () => {
    const res = await request(app.getHttpServer())
      .get('/voice/synthesize')
      .query({ text: 'Hello from Chotu' });

    expect(res.status).toBe(401);
    expect(mockVoiceService.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('rejects invalid bearer token on GET /voice/synthesize with 401 Unauthorized', async () => {
    const res = await request(app.getHttpServer())
      .get('/voice/synthesize')
      .set('Authorization', 'Bearer invalid.jwt.token')
      .query({ text: 'Hello from Chotu' });

    expect(res.status).toBe(401);
    expect(mockVoiceService.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('allows authenticated user with valid JWT and preserves audio/mpeg response', async () => {
    const accessToken = jwtService.sign({
      sub: 'user-agent-1',
      tenantId: 'tenant-1',
      role: 'AGENT',
    });

    const res = await request(app.getHttpServer())
      .get('/voice/synthesize')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ text: 'Namaste from Chotu AI' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(Buffer.from(res.body).toString('utf8')).toBe('ID3_AUDIO_BYTES');
    expect(mockVoiceService.synthesizeSpeech).toHaveBeenCalledWith('Namaste from Chotu AI');
  });
});

