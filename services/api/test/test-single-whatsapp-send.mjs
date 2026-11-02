// Controlled Single WhatsApp Template Test Script
// Strictly sends exactly ONE message to the configured WHATSAPP_TEST_RECIPIENT using synthetic data.
// Never prints unmasked phone numbers, access tokens, or sensitive credentials.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { WhatsAppCloudAdapter } from '../dist/integrations/adapters/whatsapp-cloud.adapter.js';

function maskPhone(phone) {
  const clean = (phone || '').replace(/[^\d+]/g, '');
  if (clean.length <= 4) return '****';
  return `${clean.slice(0, 3)}*****${clean.slice(-4)}`;
}

export async function runControlledWhatsAppTest() {
  console.log('====================================================');
  console.log('📱 myCashflo — Controlled WhatsApp Template Single Test');
  console.log('====================================================\n');

  // 1. Safety verification
  const autoReminders = (process.env.AUTOMATED_REMINDERS_ENABLED || 'false').toLowerCase();
  if (autoReminders === 'true') {
    throw new Error('SAFETY CHECK FAILED: AUTOMATED_REMINDERS_ENABLED is true. Must remain false.');
  }

  const rawTestRecipient = process.env.WHATSAPP_TEST_RECIPIENT;
  if (!rawTestRecipient) {
    throw new Error('SAFETY CHECK FAILED: WHATSAPP_TEST_RECIPIENT is not configured.');
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('CONFIGURATION CHECK FAILED: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN missing.');
  }

  console.log(`[PASS] AUTOMATED_REMINDERS_ENABLED: false`);
  console.log(`[PASS] Configured Test Recipient: ${maskPhone(rawTestRecipient)}`);
  console.log(`[PASS] Provider Credentials: Present and loaded from environment\n`);

  // 2. Instantiate adapter
  const adapter = new WhatsAppCloudAdapter();

  // 3. Prepare synthetic payment reminder overdue payload
  const syntheticInput = {
    to: rawTestRecipient,
    recipientName: 'Acme Synthetic Technologies Pvt Ltd',
    template: 'PAYMENT_REMINDER_OVERDUE',
    message: 'Notice from myCashflo Demo: Overdue invoice INV-SYNTH-WA-001 for ₹25,000.',
    payload: {
      customerName: 'Acme Synthetic Technologies Pvt Ltd',
      companyName: 'myCashflo Demo',
      invoiceNumber: 'INV-SYNTH-WA-001',
      amount: '₹25,000',
      dueDate: '10 Oct 2026',
      companyContactNumber: '+91 80 4567 8900',
      isTest: true,
      testScope: 'SINGLE_CONTROLLED_TEMPLATE_TEST',
    },
  };

  const toDigits = rawTestRecipient.replace(/[^\d]/g, '');
  const templatePayload = adapter.buildTemplatePayload(syntheticInput, toDigits);

  console.log('--- Outbound Payload Preview (Sanitized) ---');
  console.log(
    JSON.stringify(
      {
        ...templatePayload,
        to: maskPhone(templatePayload.to),
      },
      null,
      2,
    ),
  );
  console.log('--------------------------------------------\n');

  console.log(`Dispatching single message to ${maskPhone(rawTestRecipient)} via Meta WhatsApp Cloud API...`);
  const result = await adapter.send(syntheticInput);

  console.log('\n--- Provider Response Summary ---');
  console.log(`Provider: ${result.provider}`);
  console.log(`Provider Message ID: ${result.messageId}`);
  console.log(`Provider HTTP Status: ${result.status}`);
  console.log(`Is Simulated: ${result.isSimulated}`);
  if (result.raw) {
    const rawClean = JSON.parse(
      JSON.stringify(result.raw, (key, value) => {
        if (typeof value === 'string' && value.startsWith('EAAG')) return '[REDACTED_TOKEN]';
        return value;
      }),
    );
    console.log('Raw Provider Response:', JSON.stringify(rawClean, null, 2));
  }
  console.log('----------------------------------\n');

  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runControlledWhatsAppTest()
    .catch((err) => {
      console.error(`❌ Test dispatch failed: ${err.message}`);
      process.exitCode = 1;
    });
}
