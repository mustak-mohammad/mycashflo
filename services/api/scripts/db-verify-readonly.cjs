/**
 * myCashFlo — Phase 1C.1 Read-Only Database Verification Script
 * Strictly read-only verification of database identity, migrations, and records.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    // 1. Database name check
    const dbNameResult = await prisma.$queryRawUnsafe('SELECT current_database() as db_name');
    const currentDb = dbNameResult[0]?.db_name;

    // 2. Applied migrations
    const migrations = await prisma.$queryRawUnsafe(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at ASC'
    );

    // 3. Record counts
    const customerCount = await prisma.customer.count();
    const invoiceCount = await prisma.invoice.count();
    const notificationCount = await prisma.notification.count();
    const webhookReplayCount = await prisma.webhookReplay.count();

    // 4. Consent breakdown
    const customers = await prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        emailConsent: true,
        whatsappConsent: true,
        smsConsent: true,
        notes: true,
      },
    });

    const consentSummary = {
      total: customerCount,
      email: { OPTED_IN: 0, OPTED_OUT: 0, UNKNOWN: 0 },
      whatsapp: { OPTED_IN: 0, OPTED_OUT: 0, UNKNOWN: 0 },
      sms: { OPTED_IN: 0, OPTED_OUT: 0, UNKNOWN: 0 },
    };

    for (const c of customers) {
      consentSummary.email[c.emailConsent || 'UNKNOWN'] = (consentSummary.email[c.emailConsent || 'UNKNOWN'] || 0) + 1;
      consentSummary.whatsapp[c.whatsappConsent || 'UNKNOWN'] = (consentSummary.whatsapp[c.whatsappConsent || 'UNKNOWN'] || 0) + 1;
      consentSummary.sms[c.smsConsent || 'UNKNOWN'] = (consentSummary.sms[c.smsConsent || 'UNKNOWN'] || 0) + 1;
    }

    // 5. Notification statuses
    const notifications = await prisma.notification.findMany({
      select: {
        id: true,
        status: true,
        channel: true,
        failReason: true,
      },
    });

    const statusCounts = {};
    let suppressedCount = 0;
    for (const n of notifications) {
      statusCounts[n.status] = (statusCounts[n.status] || 0) + 1;
      if (n.status === 'SUPPRESSED') suppressedCount++;
    }

    const report = {
      database: currentDb,
      appliedMigrationsCount: migrations.length,
      migrations: migrations.map((m) => ({
        name: m.migration_name,
        finishedAt: m.finished_at,
        rolledBack: m.rolled_back_at !== null,
      })),
      counts: {
        customers: customerCount,
        invoices: invoiceCount,
        notifications: notificationCount,
        webhookReplays: webhookReplayCount,
      },
      consentSummary,
      notificationStatuses: statusCounts,
      suppressedNotificationsCount: suppressedCount,
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Database verification error:', err);
  process.exit(1);
});
