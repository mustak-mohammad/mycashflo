import { PrismaClient } from '../services/api/node_modules/@prisma/client/index.js';
import { RemindersService } from '../services/api/dist/reminders/reminders.service.js';
import { AuditLogsService } from '../services/api/dist/audit-logs/audit-logs.service.js';
import { NotificationsService } from '../services/api/dist/notifications/notifications.service.js';
import { IntegrationsService } from '../services/api/dist/integrations/integrations.service.js';
import { PromptsService } from '../services/api/dist/prompts/prompts.service.js';

const prisma = new PrismaClient();

async function runVerification() {
  console.log('====================================================');
  console.log('🔍 E2E Live Database Verification: Automated Reminders');
  console.log('====================================================\n');

  await prisma.$connect();

  const auditLogs = new AuditLogsService(prisma);
  const notifications = new NotificationsService(prisma, auditLogs);
  const integrations = new IntegrationsService(prisma, auditLogs);
  const prompts = new PromptsService(prisma, auditLogs);
  const reminders = new RemindersService(prisma, auditLogs, notifications, integrations, prompts);

  const demoCorpId = 'cmv6st4xn0000cxtopjci9l0h';
  const abcTenantId = 'cmvgtxnsn0009cx0wljknr02r';

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

  // ── 1. Empty State & Settled Invoice Verification (Demo Corp) ──
  console.log('--- 1. Evaluating Settled Invoices & Empty State (Demo Corp) ---');
  const demoPreview = await reminders.previewReminders({
    userId: 'test_admin',
    tenantId: demoCorpId,
    role: 'ADMIN',
  });

  console.log(`Demo Corp Evaluated: ${demoPreview.evaluatedCount}, Eligible: ${demoPreview.eligibleCount}, Total Invoices: ${demoPreview.totalTenantInvoices}, Settled: ${demoPreview.settledInvoicesCount}`);
  assert(
    demoPreview.evaluatedCount === 0 &&
    demoPreview.eligibleCount === 0 &&
    demoPreview.items.length === 0,
    'Zero eligible invoices evaluated when all tenant invoices are fully settled (PAID, 0 balance)',
  );
  assert(
    demoPreview.totalTenantInvoices === 8 && demoPreview.settledInvoicesCount === 8,
    'Accurately reflects total tenant invoices (8) and fully settled count (8) for clean empty-state messaging',
  );
  assert(demoPreview.isDryRun === true, 'Preview strictly enforces isDryRun: true');

  // ── 2. Outstanding Invoices & Due-Soon Stage (ABC Tenant) ──
  console.log('\n--- 2. Evaluating Active Outstanding Invoices (ABC Tenant) ---');
  const abcPreview = await reminders.previewReminders({
    userId: 'test_admin',
    tenantId: abcTenantId,
    role: 'ADMIN',
  });

  console.log(`ABC Evaluated: ${abcPreview.evaluatedCount}, Eligible: ${abcPreview.eligibleCount}, Suppressed: ${abcPreview.suppressedCount}`);
  assert(abcPreview.evaluatedCount >= 1, 'Evaluates actual outstanding invoices from database for ABC tenant');

  const testInv = abcPreview.items.find(i => i.invoiceNumber === 'INV-TEST-001');
  assert(Boolean(testInv), 'Finds outstanding invoice INV-TEST-001 in evaluation items');
  if (testInv) {
    console.log(`INV-TEST-001 details: Customer=${testInv.customerName}, Amount=₹${testInv.outstandingAmount}, DueDate=${testInv.dueDate}, Stage=${testInv.stage}`);
    assert(testInv.outstandingAmount === 75000, `Outstanding balance matches actual remaining balance (₹75,000, not total ₹100,000)`);
    assert(testInv.stage === 'DUE_SOON', `Due date in future correctly categorizes as DUE_SOON stage`);
    assert(Boolean(testInv.messagePreview), 'Generates polite Chotu AI message preview');
    assert(testInv.messagePreview?.message.includes('INV-TEST-001'), 'Message preview includes verified invoice number');
    assert(testInv.messagePreview?.message.includes('₹75,000'), 'Message preview includes verified outstanding amount');
    assert(testInv.messagePreview?.message.includes('Sunrise Technologies'), 'Message preview includes customer name');
  }

  // ── 3. Configuration Persistence & Tenant Isolation ──
  console.log('\n--- 3. Testing Configuration Persistence & Isolation ---');
  const initialAbcSettings = await reminders.getSettings(abcTenantId);
  const initialDemoSettings = await reminders.getSettings(demoCorpId);

  // Update ABC settings
  await reminders.updateSettings(
    abcTenantId,
    {
      enabled: true,
      dryRun: true,
      channelPreference: 'BOTH',
      timezone: 'Asia/Kolkata',
      quietHoursStart: 21,
      quietHoursEnd: 8,
      maxDailyPerCustomer: 2,
      minDaysBetweenReminders: 4,
      testRecipientEmail: 'mustakmohammad396@gmail.com',
      testRecipientPhone: '919618954429',
    },
    'test_runner',
  );

  const reloadedAbcSettings = await reminders.getSettings(abcTenantId);
  assert(
    reloadedAbcSettings.enabled === true &&
    reloadedAbcSettings.channelPreference === 'BOTH' &&
    reloadedAbcSettings.quietHours.startHour === 21 &&
    reloadedAbcSettings.quietHours.endHour === 8 &&
    reloadedAbcSettings.maxDailyPerCustomer === 2 &&
    reloadedAbcSettings.minDaysBetweenReminders === 4 &&
    reloadedAbcSettings.testRecipientEmail === 'mustakmohammad396@gmail.com',
    'Tenant reminder settings persist accurately in database (IntegrationConfig)',
  );

  // Check Demo Corp settings were NOT mutated
  const reloadedDemoSettings = await reminders.getSettings(demoCorpId);
  assert(
    reloadedDemoSettings.enabled === initialDemoSettings.enabled &&
    reloadedDemoSettings.channelPreference === initialDemoSettings.channelPreference &&
    reloadedDemoSettings.maxDailyPerCustomer === initialDemoSettings.maxDailyPerCustomer,
    'Settings are strictly isolated per tenant — updating ABC did not alter Demo Corp settings',
  );

  // ── 4. Test Recipient Allowlist & Security Verification ──
  console.log('\n--- 4. Test Sending Workflow & Safety Guard Verification ---');
  // Attempt to test send with an unauthorized arbitrary customer address
  let blockedUnauthorized = false;
  try {
    await reminders.sendTestReminder(
      { userId: 'test_admin', tenantId: abcTenantId, role: 'ADMIN' },
      {
        invoiceId: testInv?.invoiceId || '',
        channel: 'EMAIL',
        recipient: 'unauthorized_customer_address@victim.com',
      },
    );
  } catch (err) {
    blockedUnauthorized = true;
    assert(
      err.message.includes('blocked'),
      `Safety Guard blocked outreach to unauthorized customer recipient: ${err.message}`,
    );
  }
  if (!blockedUnauthorized) {
    assert(false, 'Expected unauthorized recipient override to be blocked');
  }

  // Cross-tenant invoice test send rejection
  let blockedCrossTenant = false;
  try {
    await reminders.sendTestReminder(
      { userId: 'test_admin', tenantId: demoCorpId, role: 'ADMIN' },
      {
        invoiceId: testInv?.invoiceId || '', // Belongs to ABC, not Demo Corp
        channel: 'EMAIL',
        recipient: 'delivered@resend.dev',
      },
    );
  } catch (err) {
    blockedCrossTenant = true;
    assert(
      err.message.includes('Invoice not found in tenant'),
      'Cross-tenant isolation enforced: cannot test reminders for another tenant invoice',
    );
  }
  if (!blockedCrossTenant) {
    assert(false, 'Expected cross-tenant invoice to throw NotFoundException');
  }

  // Test send to explicitly allowed test domain or test recipient
  // Note: EMAIL_DELIVERY_ENABLED is false, so it safely simulates dispatch to the test recipient
  if (testInv) {
    const testSendResult = await reminders.sendTestReminder(
      { userId: 'test_admin', tenantId: abcTenantId, role: 'ADMIN' },
      {
        invoiceId: testInv.invoiceId,
        channel: 'EMAIL',
        recipient: 'delivered@resend.dev',
      },
    );
    assert(
      testSendResult.success === true &&
      testSendResult.notification?.payload?.isTest === true &&
      testSendResult.notification?.payload?.testRecipient === 'delivered@resend.dev' &&
      testSendResult.notification?.payload?.recipient === 'delivered@resend.dev',
      `Controlled test reminder safely dispatched exclusively to test recipient delivered@resend.dev (Message: ${testSendResult.message})`,
    );
  }

  // ── 5. Quiet Hours and Timezone Logic Verification ──
  console.log('\n--- 5. Timezone & Quiet Hours Calculations ---');
  const quietHours = { startHour: 19, endHour: 9 }; // 7 PM to 9 AM
  // 3:00 PM IST (09:30 UTC) -> business hour
  const afternoonDate = new Date('2026-10-22T09:30:00.000Z');
  // 11:00 PM IST (17:30 UTC) -> quiet hour
  const nightDate = new Date('2026-10-22T17:30:00.000Z');

  assert(
    reminders.isQuietHours('Asia/Kolkata', quietHours, afternoonDate) === false,
    'Correctly permits reminders during business hours (3:00 PM IST)',
  );
  assert(
    reminders.isQuietHours('Asia/Kolkata', quietHours, nightDate) === true,
    'Correctly suppresses reminders during quiet hours (11:00 PM IST)',
  );

  console.log('\n====================================================');
  console.log(`E2E Verification Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification().catch(async (e) => {
  console.error('E2E Verification encountered error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
