// Safe Resend Email Integration Verification Script
// Strictly enforces safety policies: NO real customers contacted, single test recipient only.
import { ResendEmailAdapter } from '../dist/integrations/adapters/resend-email.adapter.js';

async function verifyResendIntegration() {
  console.log('====================================================');
  console.log('📧 myCashflo — Resend Email Integration Safe Verification');
  console.log('====================================================\n');

  const adapter = new ResendEmailAdapter();
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

  // Test 1: Safe default simulation mode (EMAIL_DELIVERY_ENABLED=false)
  console.log('Test 1: Default Simulation Mode Verification');
  const simResult = await adapter.send(
    {
      to: 'customer@democorp.in',
      subject: 'Verification Test Notice',
      text: 'Test content',
    },
    { deliveryEnabled: false },
  );

  assert(
    simResult.isSimulated === true &&
      simResult.status === 'DELIVERED' &&
      simResult.provider === 'SIMULATED' &&
      simResult.messageId.startsWith('msg_sim_'),
    `Simulation mode active: outbound email safely simulated (Message ID: ${simResult.messageId})`,
  );

  // Test 2: Safety Guard blocks real customer addresses even if delivery were enabled
  console.log('\nTest 2: Safety Guard Verification (Real Customer Outreach Suppression)');
  const blockedResult = await adapter.send(
    {
      to: 'real-customer@external-corp.in',
      subject: 'Overdue Reminder',
      text: 'Please pay invoice #INV-100',
    },
    {
      deliveryEnabled: true,
      apiKey: 're_dummy_test_key_for_guard_check',
      testRecipient: 'qa-test@mycashflo.internal',
    },
  );

  assert(
    blockedResult.status === 'FAILED' &&
      blockedResult.isSimulated === true &&
      blockedResult.error?.includes('Safety Guard') &&
      blockedResult.error?.includes('real-customer@external-corp.in'),
    'Safety Guard strictly intercepted outreach to real customer address',
  );

  // Test 3: Dedicated Test Recipient Allowlist Verification
  console.log('\nTest 3: Single Test Recipient Allowlist Check');
  const singleTestTarget = process.env.EMAIL_TEST_RECIPIENT || 'delivered@resend.dev';
  console.log(`Configured explicit test recipient: ${singleTestTarget}`);

  // When live delivery is tested without a valid API key, must throw or block
  let keyValidationCaught = false;
  try {
    await adapter.send(
      {
        to: singleTestTarget,
        subject: 'Connectivity Test',
        text: 'Testing allowlist',
      },
      {
        deliveryEnabled: true,
        apiKey: '', // No key
        testRecipient: singleTestTarget,
      },
    );
  } catch (err) {
    keyValidationCaught = true;
    assert(
      err.message?.includes('RESEND_API_KEY is not configured'),
      'Missing RESEND_API_KEY safely prevented live dispatch with BadRequestException',
    );
  }

  if (!keyValidationCaught) {
    assert(false, 'Expected missing API key to throw BadRequestException');
  }

  // Test 4: Provider Live Delivery Status Check
  console.log('\nTest 4: Provider Live Confirmation Status');
  const liveKey = process.env.RESEND_API_KEY;
  const isLiveDeliveryEnabled = String(process.env.EMAIL_DELIVERY_ENABLED).toLowerCase() === 'true';

  if (!liveKey || !isLiveDeliveryEnabled) {
    console.log('ℹ️  RESEND_API_KEY is not configured or EMAIL_DELIVERY_ENABLED is false.');
    console.log('🔒 Status: Provider real delivery is NOT ACTIVE. Simulation mode is safe default.');
    console.log('⚠️  Confirmed: Real email delivery is NOT claimed because provider API key has not executed live dispatch.');
  } else {
    console.log('Live credentials detected. Dispatching test to single recipient only...');
    const liveResult = await adapter.send(
      {
        to: singleTestTarget,
        subject: 'myCashflo — Safe Provider Verification',
        text: 'Safe verification message to test recipient.',
      },
      {
        deliveryEnabled: true,
        apiKey: liveKey,
        testRecipient: singleTestTarget,
      },
    );
    if (liveResult.status === 'SENT' && !liveResult.isSimulated) {
      console.log(`✅ Live email delivery confirmed by Resend provider! Message ID: ${liveResult.messageId}`);
    } else {
      console.log(`⚠️ Live email delivery returned status: ${liveResult.status}. Error: ${liveResult.error}`);
    }
  }

  console.log('\n====================================================');
  console.log(`Resend Safe Verification Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

verifyResendIntegration().catch((e) => {
  console.error('Verification error:', e);
  process.exit(1);
});
