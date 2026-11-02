import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from './../src/app.module.js';

describe('WhatsApp Webhook HTTP Endpoints (e2e)', () => {
  let app: INestApplication;
  const configuredVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'mycashflo_whatsapp_verify_token';
  const configuredAppSecret = process.env.WHATSAPP_APP_SECRET || 'whatsapp_app_secret_demo';

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /api/notifications/webhook/whatsapp (Challenge Verification)', () => {
    it('returns challenge with HTTP 200 when hub.verify_token and mode match configured token', async () => {
      const challengeCode = `hub_chal_${Date.now()}_abc123`;

      const response = await request(app.getHttpServer())
        .get('/api/notifications/webhook/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': configuredVerifyToken,
          'hub.challenge': challengeCode,
        })
        .expect(200);

      expect(response.text).toBe(challengeCode);
    });

    it('returns HTTP 400 when hub.verify_token does not match', async () => {
      const challengeCode = `hub_chal_${Date.now()}_bad`;

      const response = await request(app.getHttpServer())
        .get('/api/notifications/webhook/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'unauthorized_token_mismatch',
          'hub.challenge': challengeCode,
        })
        .expect(400);

      expect(response.body.message).toContain('Forbidden webhook verification token');
    });

    it('returns HTTP 400 when hub.mode is not subscribe', async () => {
      const challengeCode = `hub_chal_${Date.now()}_mode`;

      const response = await request(app.getHttpServer())
        .get('/api/notifications/webhook/whatsapp')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': configuredVerifyToken,
          'hub.challenge': challengeCode,
        })
        .expect(400);

      expect(response.body.message).toContain('Forbidden webhook verification token');
    });
  });

  describe('POST /api/notifications/webhook/whatsapp (Signature Validation)', () => {
    it('returns HTTP 200 when payload is signed with valid HMAC SHA-256', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [],
      };
      const rawBody = JSON.stringify(payload);
      const signatureHash = crypto
        .createHmac('sha256', configuredAppSecret)
        .update(rawBody)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/notifications/webhook/whatsapp')
        .set('x-hub-signature-256', `sha256=${signatureHash}`)
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ status: 'ok', processed: 0, updated: 0 });
    });

    it('returns HTTP 400 when x-hub-signature-256 is forged or invalid', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const response = await request(app.getHttpServer())
        .post('/api/notifications/webhook/whatsapp')
        .set('x-hub-signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
        .send(payload)
        .expect(400);

      expect(response.body.message).toContain('Invalid WhatsApp webhook signature');
    });

    it('returns HTTP 400 when x-hub-signature-256 header is completely missing', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const response = await request(app.getHttpServer())
        .post('/api/notifications/webhook/whatsapp')
        .send(payload)
        .expect(400);

      expect(response.body.message).toContain('Invalid WhatsApp webhook signature');
    });

    it('processes synthetic WhatsApp status payload safely returning HTTP 200 without side effects for unknown message ID', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '1959193371412227',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: '1265643423303870' },
                  statuses: [
                    {
                      id: 'wamid.HBgL_synthetic_unknown_e2e==',
                      status: 'delivered',
                      timestamp: '1729868400',
                      recipient_id: '919618954429',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };
      const rawBody = JSON.stringify(payload);
      const signatureHash = crypto
        .createHmac('sha256', configuredAppSecret)
        .update(rawBody)
        .digest('hex');

      const response = await request(app.getHttpServer())
        .post('/api/notifications/webhook/whatsapp')
        .set('x-hub-signature-256', `sha256=${signatureHash}`)
        .send(payload)
        .expect(200);

      expect(response.body).toEqual({ status: 'ok', processed: 1, updated: 0 });
    });
  });
});
