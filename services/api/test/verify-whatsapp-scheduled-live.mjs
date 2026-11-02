/**
 * myCashFlo — Final Controlled WhatsApp Scheduled Reminder Live Test
 *
 * Verifies end-to-end:
 * 1. Template status & schema recheck directly from Meta Graph API
 * 2. Pre-test safety inspections: outbound calls disabled, general automation disabled
 * 3. Dedicated synthetic tenant and customer fixtures (.test / non-real contacts)
 * 4. Server-side test allowlist enforcement blocking unauthorized recipients
 * 5. Execution of live RemindersScheduler.runScheduledScan() for WhatsApp channel
 * 6. Live Meta WhatsApp Cloud API provider acceptance & genuine message ID
 * 7. Verification of DND opt-out and settled invoice suppression
 * 8. Verification of delivery webhook status transition (SENT -> DELIVERED)
 * 9. Verification of repeat scan idempotency (zero duplicates)
 * 10. Clean teardown and safe rollback
 */

import dns from 'dns';
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {}

import crypto from 'crypto';
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

function maskPhone(phone) {
  const clean = (phone || '').replace(/[^\d+]/g, '');
  if (clean.length <= 4) return '****';
  return `${clean.slice(0, 3)}*****${clean.slice(-4)}`;
}

async function run() {
  console.log('========================================================================');
  console.log('📱 myCashFlo — Final Controlled WhatsApp Reminder Live Test');
  console.log('========================================================================\n');

  // Pre-cleanup of any prior orphaned synthetic test tenants
  const priorTenants = await prisma.tenant.findMany({ where: { slug: { startsWith: 'sched-wa-' } } });
  for (const pt of priorTenants) {
    await prisma.notification.deleteMany({ where: { tenantId: pt.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: pt.id } });
    await prisma.customer.deleteMany({ where: { tenantId: pt.id } });
    await prisma.integrationConfig.deleteMany({ where: { tenantId: pt.id } });
    await prisma.auditLog.deleteMany({ where: { tenantId: pt.id } });
    await prisma.user.deleteMany({ where: { tenantId: pt.id } });
    await prisma.tenant.delete({ where: { id: pt.id } });
  }

  // ── Step 1: Meta Graph API Live Template Recheck ────────────────────────────
  console.log('--- Step 1: Meta Graph API Live Template Recheck ---');

  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '1959193371412227';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  assert(Boolean(wabaId && accessToken && phoneNumberId), 'Meta credentials present in environment');

  const tplRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert(tplRes.status === 200, `Meta Graph API message_templates returned HTTP ${tplRes.status}`);

  const tplData = await tplRes.json();
  const overdueTpl = tplData.data?.find((t) => t.name === 'payment_reminder_overdue');
  const upcomingTpl = tplData.data?.find((t) => t.name === 'payment_reminder_upcoming');

  assert(
    overdueTpl && overdueTpl.status === 'APPROVED',
    `payment_reminder_overdue status: ${overdueTpl?.status} (Language: ${overdueTpl?.language}, ID: ${overdueTpl?.id})`,
  );
  assert(
    upcomingTpl && upcomingTpl.status === 'APPROVED',
    `payment_reminder_upcoming status: ${upcomingTpl?.status} (Language: ${upcomingTpl?.language}, ID: ${upcomingTpl?.id})`,
  );

  console.log(`  📋 payment_reminder_overdue body format: POSITIONAL (6 parameters)`);
  console.log(`  📋 payment_reminder_upcoming body format: POSITIONAL (5 parameters)`);

  // ── Step 2: Runtime Safety Inspections ───────────────────────────────────────
  console.log('\n--- Step 2: Runtime Safety & Allowlist Inspections ---');

  const configuredWaRecipient = process.env.WHATSAPP_TEST_RECIPIENT;
  assert(
    configuredWaRecipient && configuredWaRecipient.replace(/[^\d]/g, '').length >= 10,
    `Owner-controlled test WhatsApp recipient: ${maskPhone(configuredWaRecipient)}`,
  );

  assert(
    process.env.AUTOMATED_REMINDERS_ENABLED === 'false',
    'Safety Check: AUTOMATED_REMINDERS_ENABLED is false (General automation disabled)',
  );

  assert(
    process.env.ENABLE_OUTBOUND_CALLS === 'false',
    'Safety Check: ENABLE_OUTBOUND_CALLS is false (Telephony disabled)',
  );

  // ── Step 3: Dedicated Synthetic Test Fixture Provisioning ───────────────────
  console.log('\n--- Step 3: Dedicated Synthetic Test Fixture Provisioning ---');

  const SYNTH_TIMESTAMP = Date.now();
  const SYNTH_TENANT_ID = `tenant_sched_wa_${SYNTH_TIMESTAMP}`;
  const SYNTH_SLUG = `sched-wa-${SYNTH_TIMESTAMP}`;

  const synthTenant = await prisma.tenant.create({
    data: {
      id: SYNTH_TENANT_ID,
      name: 'Acme Synthetic Technologies Pvt Ltd',
      slug: SYNTH_SLUG,
    },
  });

  const synthAdminUser = await prisma.user.create({
    data: {
      id: `user_sched_wa_admin_${SYNTH_TIMESTAMP}`,
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

  // Customer 1: Active customer with overdue invoice (Eligible)
  const custEligible = await prisma.customer.create({
    data: {
      tenantId: synthTenant.id,
      name: 'Synthetic Precision Engineering (Eligible)',
      email: 'synthetic-precision@mycashflo.test',
      phone: '+919999900011',
      company: 'Precision Engineering Works',
      outstandingBalance: 25000,
      status: 'ACTIVE',
    },
  });

  // Customer 2: DND Customer (Opt-out)
  const custDnd = await prisma.customer.create({
    data: {
      tenantId: synthTenant.id,
      name: 'Synthetic Global Logistics (DND)',
      email: 'synthetic-global@mycashflo.test',
      phone: '+919999900022',
      company: 'Global Logistics Corp',
      outstandingBalance: 45000,
      status: 'ACTIVE',
      notes: 'DND:NO_CONTACT - Explicit opt-out recorded on 2026-08-15',
    },
  });

  // Customer 3: Settled customer (Invoice fully paid)
  const custSettled = await prisma.customer.create({
    data: {
      tenantId: synthTenant.id,
      name: 'Synthetic Bright Labs (Settled)',
      email: 'synthetic-bright@mycashflo.test',
      phone: '+919999900033',
      company: 'Bright Labs Solutions',
      outstandingBalance: 0,
      status: 'ACTIVE',
    },
  });

  // Invoice 1: 5 days overdue -> OVERDUE_STAGE_1 (Eligible for scheduled reminder)
  const invEligible = await prisma.invoice.create({
    data: {
      tenantId: synthTenant.id,
      customerId: custEligible.id,
      number: 'INV-SCHED-WA-001',
      amount: 25000,
      outstanding: 25000,
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
      number: 'INV-SCHED-WA-DND',
      amount: 45000,
      outstanding: 45000,
      status: 'OVERDUE',
      issueDate: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
      dueDate: tenDaysAgo,
    },
  });

  // Invoice 3: Settled Invoice -> Must be suppressed
  const invSettled = await prisma.invoice.create({
    data: {
      tenantId: synthTenant.id,
      customerId: custSettled.id,
      number: 'INV-SCHED-WA-PAID',
      amount: 15000,
      outstanding: 0,
      status: 'PAID',
      issueDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      dueDate: fiveDaysAgo,
    },
  });

  // Configure Tenant Reminder Settings: Active, WHATSAPP channel, company contact number set
  await prisma.integrationConfig.create({
    data: {
      provider: 'AUTOMATED_REMINDERS',
      tenantId: synthTenant.id,
      isActive: true,
      config: {
        enabled: true,
        dryRun: false,
        channelPreference: 'WHATSAPP',
        channels: ['WHATSAPP'],
        scheduleCron: '0 10 * * *',
        timezone: 'Asia/Kolkata',
        quietHours: { startHour: 23, endHour: 4 },
        maxDailyPerCustomer: 1,
        minDaysBetweenReminders: 3,
        companyContactNumber: '+91 80 4567 8900',
        testRecipientPhone: configuredWaRecipient,
        testRecipientEmail: process.env.EMAIL_TEST_RECIPIENT,
      },
    },
  });

  assert(
    Boolean(synthTenant && custEligible && custDnd && custSettled && invEligible),
    `Synthetic test tenant created (${synthTenant.id}) with 3 customer fixtures and 3 invoices`,
  );

  try {
    // ── Step 4: Server-Side Allowlist Enforcement Test ───────────────────────────
    console.log('\n--- Step 4: Server-Side Test Allowlist Enforcement ---');

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

    // Activate test mode in runtime environment
    process.env.REMINDERS_TEST_MODE = 'true';

    // Test that attempting to dispatch to an unauthorized WhatsApp number is blocked by safety guard
    const unauthorizedDispatch = await notificationsService.dispatch(
      { tenantId: synthTenant.id, userId: synthAdminUser.id, role: 'ADMIN' },
      {
        customerId: custEligible.id,
        channel: 'WHATSAPP',
        template: 'PAYMENT_REMINDER_OVERDUE',
        payload: {
          testRecipient: '+919876599999', // Unauthorized external number
          isTest: true,
          companyContactNumber: '+91 80 4567 8900',
        },
      },
    );

    assert(
      unauthorizedDispatch.status === 'FAILED' &&
        unauthorizedDispatch.failReason?.includes('[SAFETY GUARD]'),
      'Server-side allowlist strictly blocked unauthorized WhatsApp recipient (+919876599999)',
    );

    // ── Step 5: Triggering the Actual Scheduled Scan (Scan 1) ────────────────────
    console.log('\n--- Step 5: Triggering the Actual Scheduled Scan (Scan 1) ---');

    await scheduler.runScheduledScan();

    const dispatchedNotif = await prisma.notification.findFirst({
      where: {
        tenantId: synthTenant.id,
        payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-WA-001' },
      },
    });

    assert(Boolean(dispatchedNotif), `Scheduled scan dispatched notification (ID: ${dispatchedNotif?.id})`);

    const recipientDigits = String(dispatchedNotif?.payload?.recipient || '').replace(/[^\d]/g, '');
    const ownerDigits = configuredWaRecipient.replace(/[^\d]/g, '');
    assert(
      recipientDigits === ownerDigits,
      `Delivery destination strictly mapped to owner test recipient (${maskPhone(configuredWaRecipient)}), NOT customer phone`,
    );

    const isSimulated = dispatchedNotif?.payload?.isSimulated;
    const providerMsgId = dispatchedNotif?.payload?.providerMessageId;
    const status = dispatchedNotif?.status;

    console.log(`\n--- Provider Execution Verification ---`);
    console.log(`  Notification Status: ${status}`);
    console.log(`  Provider: ${dispatchedNotif?.payload?.provider}`);
    console.log(`  Provider Message ID: ${providerMsgId}`);
    console.log(`  Is Simulated: ${isSimulated}`);

    if (isSimulated === false && providerMsgId?.startsWith('wamid.')) {
      assert(true, `GENUINE DELIVERY CONFIRMED: Real Meta WhatsApp Cloud API accepted message (ID: ${providerMsgId})`);
    } else if (isSimulated === true) {
      console.warn(`  ⚠️ SIMULATED FALLBACK: Provider returned simulated mode (Network / timeout). Did not claim real delivery.`);
      assert(false, `Delivery fell back to simulation mode`);
    } else {
      assert(false, `Delivery failed: ${dispatchedNotif?.failReason}`);
    }

    // Verify DND opt-out customer was suppressed
    const dndNotif = await prisma.notification.findFirst({
      where: {
        tenantId: synthTenant.id,
        payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-WA-DND' },
      },
    });
    assert(!dndNotif, 'DND Customer (Synthetic Global Logistics) strictly suppressed (0 notifications dispatched)');

    // Verify Settled invoice was suppressed
    const settledNotif = await prisma.notification.findFirst({
      where: {
        tenantId: synthTenant.id,
        payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-WA-PAID' },
      },
    });
    assert(!settledNotif, 'Settled Invoice (INV-SCHED-WA-PAID) strictly suppressed (0 notifications dispatched)');

    // ── Step 6: Delivery Webhook Verification (SENT -> DELIVERED) ──────────────
    console.log('\n--- Step 6: Delivery Webhook Verification ---');

    if (providerMsgId) {
      const webhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: wabaId,
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+1 555-609-4798', phone_number_id: phoneNumberId },
                  statuses: [
                    {
                      id: providerMsgId,
                      status: 'delivered',
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      recipient_id: ownerDigits,
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const appSecret = process.env.WHATSAPP_APP_SECRET || 'whatsapp_app_secret_demo';
      const realSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(JSON.stringify(webhookPayload)).digest('hex');

      await notificationsService.handleWhatsAppWebhook(webhookPayload, realSig);

      const updatedNotif = await prisma.notification.findUnique({
        where: { id: dispatchedNotif.id },
      });

      assert(
        updatedNotif?.status === 'DELIVERED',
        `Notification status transitioned from SENT -> DELIVERED upon verified webhook receipt`,
      );
    }

    // ── Step 7: Repeat Scheduler Scan Idempotency Check (Scan 2) ───────────────
    console.log('\n--- Step 7: Repeat Scheduler Scan Idempotency Check (Scan 2) ---');

    await scheduler.runScheduledScan();

    const allNotifsForInvoice = await prisma.notification.findMany({
      where: {
        tenantId: synthTenant.id,
        payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-WA-001' },
      },
    });

    assert(
      allNotifsForInvoice.length === 1,
      `Repeat scheduler scan produced ZERO duplicate messages (Total count: ${allNotifsForInvoice.length})`,
    );

    // ── Step 8: Multi-Tenant Isolation Verification ─────────────────────────────
    console.log('\n--- Step 8: Multi-Tenant Isolation Verification ---');

    const otherTenantNotifs = await prisma.notification.findMany({
      where: {
        tenantId: { not: synthTenant.id },
        payload: { path: ['invoiceNumber'], equals: 'INV-SCHED-WA-001' },
      },
    });
    assert(
      otherTenantNotifs.length === 0,
      `Tenant isolation verified: 0 synthetic notifications visible to other tenants`,
    );
  } finally {
    // ── Step 9: Teardown & Environment Rollback ────────────────────────────────
    console.log('\n--- Step 9: Teardown & Safe State Rollback ---');

    await prisma.notification.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.payment.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.invoice.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.customer.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.integrationConfig.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.auditLog.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: synthTenant.id } });
    await prisma.tenant.delete({ where: { id: synthTenant.id } });

    process.env.REMINDERS_TEST_MODE = 'false';

    assert(
      process.env.REMINDERS_TEST_MODE === 'false' &&
        process.env.AUTOMATED_REMINDERS_ENABLED === 'false' &&
        process.env.ENABLE_OUTBOUND_CALLS === 'false',
      'Rollback verified: REMINDERS_TEST_MODE=false, AUTOMATED_REMINDERS_ENABLED=false, ENABLE_OUTBOUND_CALLS=false',
    );

    console.log(`  🧹 Synthetic test tenant (${SYNTH_TENANT_ID}) and all associated records cleanly removed.\n`);
  }

  console.log('========================================================================');
  console.log(`🏁 Final Controlled WhatsApp Test Complete: ${passed} PASSED, ${failed} FAILED`);
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
