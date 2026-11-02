/**
 * myCashFlo — Safely Activate Chotu Scheduled Reminders (Controlled Test-Only Verification)
 *
 * Verifies end-to-end:
 * 1. Pre-test safety inspections: global delivery & calling flags remain disabled
 * 2. Dedicated synthetic tenant and customer fixtures (.test TLD / non-real contacts)
 * 3. Server-side test allowlist enforcement blocking unauthorized recipients
 * 4. Activation of REMINDERS_TEST_MODE=true with EMAIL_DELIVERY_ENABLED=false
 * 5. Execution of the live RemindersScheduler.runScheduledScan() path
 * 6. Verification of provider acceptance to owner-controlled test recipient (mustakmohammad396@gmail.com)
 * 7. Verification of delivery webhook status transition (SENT -> DELIVERED)
 * 8. Verification of idempotency: repeat scheduler execution produces zero duplicate sends
 * 9. Safe rollback and teardown of all synthetic fixtures
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function run() {
  console.log('========================================================================');
  console.log('🤖 myCashFlo — Controlled Scheduled Reminder Live Test (Test-Only Mode)');
  console.log('========================================================================\n');

  // ── Section 1: Pre-Change Safety & Configuration Inspections ────────────────
  console.log('--- Section 1: Pre-Change Safety & Configuration Inspections ---');

  const configuredEmailRecipient = process.env.EMAIL_TEST_RECIPIENT;
  const configuredWaRecipient = process.env.WHATSAPP_TEST_RECIPIENT;

  assert(
    configuredEmailRecipient && configuredEmailRecipient.includes('@'),
    `Verified test email recipient configured: ${configuredEmailRecipient}`,
  );

  assert(
    configuredWaRecipient && configuredWaRecipient.replace(/[^\d]/g, '').length >= 10,
    `Verified test WhatsApp recipient configured: ${configuredWaRecipient}`,
  );

  assert(
    process.env.ENABLE_OUTBOUND_CALLS === 'false',
    'Safety Check: ENABLE_OUTBOUND_CALLS is false (Telephony disabled)',
  );

  assert(
    process.env.EMAIL_DELIVERY_ENABLED === 'false',
    'Safety Check: EMAIL_DELIVERY_ENABLED is false (General email delivery disabled)',
  );

  // ── Section 2: Dedicated Synthetic Test Tenant & Invoice Provisioning ───────
  console.log('\n--- Section 2: Dedicated Synthetic Test Fixture Provisioning ---');

  const SYNTH_TIMESTAMP = Date.now();
  const SYNTH_TENANT_ID = `tenant_sched_${SYNTH_TIMESTAMP}`;
  const SYNTH_SLUG = `sched-live-${SYNTH_TIMESTAMP}`;

  const synthTenant = await prisma.tenant.create({
    data: {
      id: SYNTH_TENANT_ID,
      name: 'Synthetic Scheduled Reminders Co (Test-Only)',
      slug: SYNTH_SLUG,
    },
  });

  const synthAdminUser = await prisma.user.create({
    data: {
      id: `user_sched_admin_${SYNTH_TIMESTAMP}`,
      email: `admin@${SYNTH_SLUG}.test`,
      passwordHash: 'dummy_hash_for_test',
      name: 'Synthetic Test Admin',
      role: 'ADMIN',
      tenantId: synthTenant.id,
    },
  });

  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Customer 1: Active customer with overdue invoice
  const custEligible = await prisma.customer.create({
    data: {
      tenantId: synthTenant.id,
      name: 'Synthetic Apex Industrial (Eligible)',
      email: 'synthetic-apex@mycashflo.test',
      phone: '+919999900010',
      company: 'Apex Industrial Parts',
      outstandingBalance: 18500,
      status: 'ACTIVE',
    },
  });

  // Customer 2: DND Customer (explicit opt-out)
  const custDnd = await prisma.customer.create({
    data: {
      tenantId: synthTenant.id,
      name: 'Synthetic Zenith Corp (DND)',
      email: 'synthetic-zenith@mycashflo.test',
      phone: '+919999900020',
      company: 'Zenith Logistics',
      outstandingBalance: 32000,
      status: 'ACTIVE',
      notes: 'DND:NO_CONTACT - Explicit opt-out requested on 2026-09-01',
    },
  });

  // Invoice 1: 5 days overdue -> OVERDUE_STAGE_1 (Eligible for scheduled reminder)
  const invEligible = await prisma.invoice.create({
    data: {
      tenantId: synthTenant.id,
      customerId: custEligible.id,
      number: 'INV-SCHED-APEX-01',
      amount: 18500,
      outstanding: 18500,
      status: 'OVERDUE',
      issueDate: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
      dueDate: fiveDaysAgo,
    },
  });

  // Invoice 2: DND Customer Invoice -> Must be suppressed
  const invDnd = await prisma.invoice.create({
    data: {
      tenantId: synthTenant.id,
      customerId: custDnd.id,
      number: 'INV-SCHED-ZENITH-01',
      amount: 32000,
      outstanding: 32000,
      status: 'OVERDUE',
      issueDate: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
      dueDate: tenDaysAgo,
    },
  });

  assert(
    synthTenant && custEligible && custDnd && invEligible && invDnd,
    `Dedicated synthetic test tenant created (${synthTenant.id}) with 2 synthetic customer profiles and 2 invoices`,
  );

  // Configure Tenant Reminder Settings: Active, live mode for this tenant, EMAIL channel
  await prisma.integrationConfig.create({
    data: {
      provider: 'AUTOMATED_REMINDERS',
      tenantId: synthTenant.id,
      isActive: true,
      config: {
        enabled: true,
        dryRun: false, // Tenant wants live reminders
        channelPreference: 'EMAIL',
        channels: ['EMAIL'],
        scheduleCron: '0 10 * * *',
        timezone: 'Asia/Kolkata',
        quietHours: { startHour: 23, endHour: 4 }, // Outside quiet hours for test execution
        maxDailyPerCustomer: 1,
        minDaysBetweenReminders: 3,
        testRecipientEmail: configuredEmailRecipient,
        testRecipientPhone: configuredWaRecipient,
      },
    },
  });

  // ── Section 3: Server-Side Test Allowlist Enforcement Verification ──────────
  console.log('\n--- Section 3: Server-Side Test Allowlist Enforcement ---');

  const { RemindersService } = await import('../dist/reminders/reminders.service.js');
  const { RemindersScheduler } = await import('../dist/reminders/reminders.scheduler.js');
  const { AuditLogsService } = await import('../dist/audit-logs/audit-logs.service.js');
  const { NotificationsService } = await import('../dist/notifications/notifications.service.js');
  const { IntegrationsService } = await import('../dist/integrations/integrations.service.js');
  const { PromptsService } = await import('../dist/prompts/prompts.service.js');
  const { ResendEmailAdapter } = await import('../dist/integrations/adapters/resend-email.adapter.js');
  const { WhatsAppCloudAdapter } = await import('../dist/integrations/adapters/whatsapp-cloud.adapter.js');
  const { RazorpayAdapter } = await import('../dist/integrations/adapters/razorpay.adapter.js');
  const { StripeAdapter } = await import('../dist/integrations/adapters/stripe.adapter.js');
  const { SipTelephonyAdapter } = await import('../dist/integrations/adapters/sip-telephony.adapter.js');
  const { SmsGatewayAdapter } = await import('../dist/integrations/adapters/sms-gateway.adapter.js');

  const auditLogsService = new AuditLogsService(prisma);
  const promptsService = new PromptsService(prisma);
  const emailAdapter = new ResendEmailAdapter();
  const waAdapter = new WhatsAppCloudAdapter();
  const razorpayAdapter = new RazorpayAdapter();
  const stripeAdapter = new StripeAdapter();
  const sipAdapter = new SipTelephonyAdapter();
  const smsAdapter = new SmsGatewayAdapter();

  const integrationsService = new IntegrationsService(
    prisma,
    auditLogsService,
    razorpayAdapter,
    stripeAdapter,
    waAdapter,
    sipAdapter,
    emailAdapter,
    smsAdapter,
  );
  const notificationsService = new NotificationsService(prisma, auditLogsService, integrationsService);
  const remindersService = new RemindersService(
    prisma,
    auditLogsService,
    notificationsService,
    integrationsService,
    promptsService,
  );
  const scheduler = new RemindersScheduler(prisma, remindersService);

  // Activate test mode in environment
  process.env.REMINDERS_TEST_MODE = 'true';

  // Test that attempting to dispatch to an unauthorized recipient is rejected by the server allowlist
  const unauthorizedDispatch = await notificationsService.dispatch(
    { tenantId: synthTenant.id, userId: synthAdminUser.id, role: 'ADMIN' },
    {
      customerId: custEligible.id,
      channel: 'EMAIL',
      template: 'PAYMENT_REMINDER_OVERDUE',
      payload: {
        testRecipient: 'unauthorized-external@client-domain.in',
        isTest: true,
      },
    },
  );

  assert(
    unauthorizedDispatch.status === 'FAILED' &&
      unauthorizedDispatch.failReason?.includes('[SAFETY GUARD]'),
    'Server-side allowlist strictly blocked unauthorized recipient (unauthorized-external@client-domain.in)',
  );

  // ── Section 4: Triggering the Scheduled Automation Path (Run 1) ─────────────
  console.log('\n--- Section 4: Triggering the Scheduled Automation Path (Scan 1) ---');

  // Trigger the actual scheduler method: RemindersScheduler.runScheduledScan()
  // This executes the identical path that runs every 15 minutes in production
  await scheduler.runScheduledScan();

  // Verify the Notification created in the database for the synthetic tenant
  const dispatchedNotif = await prisma.notification.findFirst({
    where: {
      tenantId: synthTenant.id,
      payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-APEX-01' },
    },
  });

  assert(
    Boolean(dispatchedNotif),
    `Scheduled job evaluated synthetic tenant and dispatched eligible invoice reminder (ID: ${dispatchedNotif?.id})`,
  );

  assert(
    dispatchedNotif?.payload?.recipient === configuredEmailRecipient,
    `Delivery destination strictly mapped to owner-controlled allowlisted recipient (${configuredEmailRecipient}), NOT synthetic customer`,
  );

  assert(
    dispatchedNotif?.payload?.isTest === true &&
      dispatchedNotif?.payload?.testScope === 'SCHEDULED_REMINDER_TEST',
    'Dispatched payload tagged with isTest: true and testScope: SCHEDULED_REMINDER_TEST',
  );

  assert(
    dispatchedNotif?.status === 'SENT',
    `Provider status verified as SENT (PROVIDER_ACCEPTED) with Provider Msg ID: ${dispatchedNotif?.payload?.providerMessageId}`,
  );

  assert(
    dispatchedNotif?.payload?.isSimulated === false,
    'Live delivery confirmed: isSimulated is false (real HTTP request accepted by Resend API)',
  );

  // Check that Customer Zenith (DND) was evaluated and suppressed
  const dndNotif = await prisma.notification.findFirst({
    where: {
      tenantId: synthTenant.id,
      payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-ZENITH-01' },
    },
  });

  assert(
    !dndNotif,
    'DND Customer (Synthetic Zenith Corp) strictly suppressed by scheduler (0 notifications dispatched)',
  );

  // ── Section 5: Delivery Webhook Lifecycle Verification ──────────────────────
  console.log('\n--- Section 5: Delivery Webhook Lifecycle Verification ---');

  // Distinguish PROVIDER_ACCEPTED (SENT) from DELIVERED
  // Simulate provider delivery webhook confirmation
  await notificationsService.handleEmailWebhook(
    {
      type: 'email.delivered',
      data: {
        email_id: dispatchedNotif.payload.providerMessageId,
        to: [configuredEmailRecipient],
        created_at: new Date().toISOString(),
      },
    },
    'mock_valid_signature',
  );

  const confirmedNotif = await prisma.notification.findUnique({
    where: { id: dispatchedNotif.id },
  });

  assert(
    confirmedNotif?.status === 'DELIVERED',
    `Status accurately transitioned from PROVIDER_ACCEPTED (SENT) to DELIVERED upon verified webhook receipt`,
  );

  // ── Section 6: Idempotency & Duplicate Suppression on Repeated Scan ────────
  console.log('\n--- Section 6: Idempotency on Repeated Scheduler Scan (Scan 2) ---');

  // Trigger the scheduler a second time immediately
  await scheduler.runScheduledScan();

  // Query all notifications for this invoice in the database
  const allNotifsForInvoice = await prisma.notification.findMany({
    where: {
      tenantId: synthTenant.id,
      payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-APEX-01' },
    },
  });

  assert(
    allNotifsForInvoice.length === 1,
    `Repeat scheduler scan produced ZERO duplicate messages (Total notifications count: ${allNotifsForInvoice.length})`,
  );

  // ── Section 7: Teardown & Rollback to Safe Default State ────────────────────
  console.log('\n--- Section 7: Teardown & Rollback to Safe Default State ---');

  // Clean up all synthetic records created for this test
  await prisma.notification.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.invoice.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.customer.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.integrationConfig.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.auditLog.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.user.deleteMany({ where: { tenantId: synthTenant.id } });
  await prisma.tenant.delete({ where: { id: synthTenant.id } });

  // Rollback test mode in environment
  process.env.REMINDERS_TEST_MODE = 'false';

  assert(
    process.env.REMINDERS_TEST_MODE === 'false' &&
      process.env.AUTOMATED_REMINDERS_ENABLED === 'false' &&
      process.env.EMAIL_DELIVERY_ENABLED === 'false' &&
      process.env.ENABLE_OUTBOUND_CALLS === 'false',
    'Rollback complete: REMINDERS_TEST_MODE=false, AUTOMATED_REMINDERS_ENABLED=false, EMAIL_DELIVERY_ENABLED=false, ENABLE_OUTBOUND_CALLS=false',
  );

  console.log(`  🧹 Synthetic test tenant (${SYNTH_TENANT_ID}) and all associated records cleanly removed.\n`);

  console.log('========================================================================');
  console.log(`🏁 Scheduled Live Reminder Test Complete: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(async (err) => {
  console.error('\n❌ Fatal test runner error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
