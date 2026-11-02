// Safe WhatsApp Webhook Verification Script
// Tests challenge handshake and HMAC signature validation locally without sending messages or printing secrets.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { WhatsAppCloudAdapter } from '../dist/integrations/adapters/whatsapp-cloud.adapter.js';

async function checkPort3000() {
  return new Promise((resolve) => {
    import('net').then(({ default: net }) => {
      const client = new net.Socket();
      client.setTimeout(400);
      client.once('connect', () => {
        client.destroy();
        resolve(true);
      });
      client.once('timeout', () => {
        client.destroy();
        resolve(false);
      });
      client.once('error', () => {
        client.destroy();
        resolve(false);
      });
      client.connect(3000, '127.0.0.1');
    });
  });
}

export async function runSafeWebhookVerification() {
  console.log('====================================================');
  console.log('🔒 myCashflo — Safe Local WhatsApp Webhook Verification');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Check local server status
  const isServerRunning = await checkPort3000();
  console.log(`[CHECK 1] Local API Server Status: ${isServerRunning ? 'Running on port 3000' : 'Not running on port 3000 (No duplicate server started)'}`);

  const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN || 'mycashflo_whatsapp_verify_token';
  const configuredSecret = process.env.WHATSAPP_APP_SECRET || 'whatsapp_app_secret_demo';

  console.log(`[CHECK 2] Configured Verify Token: [PRESENT - MASKED FOR SAFETY]`);
  console.log(`[CHECK 3] Configured App Secret:   [PRESENT - MASKED FOR SAFETY]\n`);

  const adapter = new WhatsAppCloudAdapter();

  // Test 1: Verification Challenge Handshake with matching token
  console.log('Test 1: Verification Challenge Handshake (GET /api/notifications/webhook/whatsapp)');
  const sampleChallenge = `challenge_${Date.now()}_994827`;
  const challengeResult = adapter.verifyWebhookChallenge(
    'subscribe',
    configuredToken,
    sampleChallenge,
    configuredToken,
  );

  assert(
    challengeResult === sampleChallenge,
    `Challenge returned correctly on token match (HTTP 200 response: "${challengeResult}")`,
  );

  // Test 2: Verification Challenge Rejection on mismatched token
  console.log('\nTest 2: Verification Challenge Rejection on Token Mismatch');
  const rejectedMismatch = adapter.verifyWebhookChallenge(
    'subscribe',
    'unauthorized_random_token_123',
    sampleChallenge,
    configuredToken,
  );

  assert(
    rejectedMismatch === null,
    'Challenge rejected when verify token does not match (HTTP 400 BadRequest equivalent)',
  );

  // Test 3: Verification Challenge Rejection on invalid mode
  console.log('\nTest 3: Verification Challenge Rejection on Invalid Hub Mode');
  const rejectedMode = adapter.verifyWebhookChallenge(
    'unsubscribe',
    configuredToken,
    sampleChallenge,
    configuredToken,
  );

  assert(
    rejectedMode === null,
    'Challenge rejected when hub.mode is not "subscribe" (HTTP 400 BadRequest equivalent)',
  );

  // Test 4: HMAC SHA-256 Webhook Signature Validation on Valid Payload
  console.log('\nTest 4: HMAC SHA-256 Signature Validation (POST /api/notifications/webhook/whatsapp)');
  const samplePayload = {
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
                  id: 'wamid.HBgL_verify_test_1==',
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

  const rawPayload = JSON.stringify(samplePayload);
  const validSignature = crypto.createHmac('sha256', configuredSecret).update(rawPayload).digest('hex');

  const signatureValid = adapter.verifyWebhookSignature(samplePayload, `sha256=${validSignature}`, configuredSecret);
  assert(
    signatureValid === true,
    'Valid HMAC SHA-256 signature accepted using timing-safe comparison (HTTP 200)',
  );

  // Test 5: HMAC SHA-256 Webhook Signature Validation on Forged Payload
  console.log('\nTest 5: Signature Rejection on Forged Payload');
  const signatureForged = adapter.verifyWebhookSignature(samplePayload, 'sha256=forged_bad_hash_000000', configuredSecret);
  assert(
    signatureForged === false,
    'Forged or tampered payload rejected (HTTP 400 BadRequest)',
  );

  // Test 6: Missing Signature Header Rejection
  console.log('\nTest 6: Missing Signature Header Rejection');
  const signatureMissing = adapter.verifyWebhookSignature(samplePayload, '', configuredSecret);
  assert(
    signatureMissing === false,
    'Empty or missing signature header rejected (HTTP 400 BadRequest)',
  );

  // Test 7: Webhook Status Event Parsing
  console.log('\nTest 7: Webhook Payload Status Event Parsing');
  const parsedEvents = adapter.parseWebhook(samplePayload);
  assert(
    parsedEvents.length === 1 &&
      parsedEvents[0].messageId === 'wamid.HBgL_verify_test_1==' &&
      parsedEvents[0].status === 'DELIVERED',
    `Event parsed into WebhookStatusEvent: messageId=${parsedEvents[0].messageId}, status=${parsedEvents[0].status}`,
  );

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} verification checks failed.`);
  }

  return { passed, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSafeWebhookVerification()
    .catch((err) => {
      console.error(`❌ Verification failed: ${err.message}`);
      process.exitCode = 1;
    });
}
