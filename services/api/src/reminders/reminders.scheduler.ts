import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RemindersService } from './reminders.service.js';

@Injectable()
export class RemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remindersService: RemindersService,
  ) {}

  onModuleInit() {
    const globalEnabled = (process.env.AUTOMATED_REMINDERS_ENABLED || '').toLowerCase() === 'true';
    this.logger.log(
      `[RemindersScheduler] Initializing automated payment reminders scheduler. Global flag AUTOMATED_REMINDERS_ENABLED: ${globalEnabled}`,
    );

    // Run initial scan 30 seconds after startup
    this.startupTimer = setTimeout(() => {
      this.runScheduledScan().catch((err) => {
        this.logger.error(`Initial reminder scan encountered error: ${err.message}`);
      });
    }, 30000);

    // Schedule periodic recurring scan every 15 minutes (15 * 60 * 1000 ms)
    this.timer = setInterval(() => {
      this.runScheduledScan().catch((err) => {
        this.logger.error(`Periodic reminder scan encountered error: ${err.message}`);
      });
    }, 15 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('[RemindersScheduler] Stopped periodic reminders timer.');
    }
  }

  /**
   * Main scheduled execution loop across all active tenants
   */
  async runScheduledScan() {
    if (this.isRunning) {
      this.logger.debug('[RemindersScheduler] Previous scan is still active. Skipping tick.');
      return;
    }

    this.isRunning = true;
    try {
      const globalEnabled = (process.env.AUTOMATED_REMINDERS_ENABLED || '').toLowerCase() === 'true';
      const testMode = (process.env.REMINDERS_TEST_MODE || '').toLowerCase() === 'true';

      // Find all active tenants
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true, name: true },
      });

      for (const tenant of tenants) {
        try {
          const settings = await this.remindersService.getSettings(tenant.id);

          // If tenant hasn't enabled reminders, skip
          if (!settings.enabled) {
            continue;
          }

          // If globally disabled and not in test mode, log safety notice
          if (!globalEnabled && !testMode) {
            this.logger.debug(
              `[RemindersScheduler] AUTOMATED_REMINDERS_ENABLED is false. Tenant ${tenant.name} (${tenant.id}) will only evaluate in dry-run simulation mode.`,
            );
          } else if (testMode) {
            this.logger.log(
              `[RemindersScheduler] REMINDERS_TEST_MODE is true. Tenant ${tenant.name} (${tenant.id}) evaluating in test-only mode restricted to allowlisted recipients.`,
            );
          }

          const summary = await this.remindersService.evaluateTenantReminders(tenant.id, {
            force: false, // Strictly respect quiet hours
            dryRunOverride: (!globalEnabled && !testMode) || settings.dryRun,
            userId: 'SYSTEM_SCHEDULER',
          });

          if (summary.eligibleCount > 0) {
            this.logger.log(
              `[RemindersScheduler] Completed automated reminder run for ${tenant.name}: evaluated ${summary.evaluatedCount}, eligible ${summary.eligibleCount}, dispatched ${summary.dispatchedCount}, suppressed ${summary.suppressedCount} (dryRun: ${summary.isDryRun})`,
            );
          }
        } catch (tenantErr: any) {
          this.logger.error(
            `[RemindersScheduler] Error processing automated reminders for tenant ${tenant.name} (${tenant.id}): ${tenantErr.message}`,
          );
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
