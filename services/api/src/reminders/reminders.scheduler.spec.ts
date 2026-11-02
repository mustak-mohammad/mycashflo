import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemindersScheduler } from './reminders.scheduler.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RemindersService } from './reminders.service.js';

describe('RemindersScheduler (Scheduled Overdue Scan Automation)', () => {
  let scheduler: RemindersScheduler;
  let mockPrisma: any;
  let mockRemindersService: any;

  beforeEach(() => {
    vi.useFakeTimers();

    mockPrisma = {
      tenant: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'tenant_1', name: 'Acme Corp' },
          { id: 'tenant_2', name: 'Beta Ltd' },
        ]),
      },
    };

    mockRemindersService = {
      getSettings: vi.fn().mockImplementation((tenantId: string) => {
        if (tenantId === 'tenant_1') {
          return Promise.resolve({
            enabled: true,
            dryRun: true,
            timezone: 'Asia/Kolkata',
            quietHours: { startHour: 19, endHour: 9 },
          });
        }
        return Promise.resolve({
          enabled: false,
          dryRun: true,
          timezone: 'Asia/Kolkata',
          quietHours: { startHour: 19, endHour: 9 },
        });
      }),
      evaluateTenantReminders: vi.fn().mockResolvedValue({
        tenantId: 'tenant_1',
        evaluatedCount: 5,
        eligibleCount: 2,
        dispatchedCount: 2,
        suppressedCount: 3,
        failedCount: 0,
        isDryRun: true,
        globalEnabled: false,
        timestamp: new Date().toISOString(),
        items: [],
      }),
    };

    scheduler = new RemindersScheduler(
      mockPrisma as PrismaService,
      mockRemindersService as RemindersService,
    );

    delete process.env.AUTOMATED_REMINDERS_ENABLED;
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('1. initializes timer and schedules periodic 15-minute scans and startup scan', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    scheduler.onModuleInit();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000);
  });

  it('2. cleans up intervals on module destroy without leaks', () => {
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
    // Subsequent timer tick should not trigger anything
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('3. executes scheduled scan across active tenants respecting enabled flag', async () => {
    await scheduler.runScheduledScan();

    expect(mockPrisma.tenant.findMany).toHaveBeenCalled();
    expect(mockRemindersService.getSettings).toHaveBeenCalledWith('tenant_1');
    expect(mockRemindersService.getSettings).toHaveBeenCalledWith('tenant_2');

    // tenant_1 is enabled -> evaluated
    expect(mockRemindersService.evaluateTenantReminders).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({
        force: false,
        dryRunOverride: true, // forced because AUTOMATED_REMINDERS_ENABLED is false
        userId: 'SYSTEM_SCHEDULER',
      }),
    );

    // tenant_2 is disabled -> skipped
    expect(mockRemindersService.evaluateTenantReminders).not.toHaveBeenCalledWith(
      'tenant_2',
      expect.any(Object),
    );
  });

  it('4. strictly forces dry-run simulation when AUTOMATED_REMINDERS_ENABLED is false', async () => {
    process.env.AUTOMATED_REMINDERS_ENABLED = 'false';

    // Even if tenant configured dryRun: false, global flag enforces dry-run safety
    mockRemindersService.getSettings.mockResolvedValueOnce({
      enabled: true,
      dryRun: false,
    });

    await scheduler.runScheduledScan();

    expect(mockRemindersService.evaluateTenantReminders).toHaveBeenCalledWith(
      'tenant_1',
      expect.objectContaining({
        dryRunOverride: true,
      }),
    );
  });

  it('5. prevents overlapping concurrent scans when previous scan is still in progress', async () => {
    let releaseScan: () => void;
    mockPrisma.tenant.findMany.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseScan = () => resolve([{ id: 'tenant_1', name: 'Acme Corp' }]);
        }),
    );

    const firstRun = scheduler.runScheduledScan();

    // Trigger second scan while first is in-flight awaiting findMany
    await scheduler.runScheduledScan();

    // findMany should have only been invoked once because isRunning is true
    expect(mockPrisma.tenant.findMany).toHaveBeenCalledTimes(1);

    releaseScan!();
    await firstRun;
  });

  it('6. isolates tenant errors so one failing tenant does not block others', async () => {
    mockRemindersService.getSettings.mockImplementation((id: string) => {
      if (id === 'tenant_1') {
        return Promise.reject(new Error('Tenant 1 DB timeout'));
      }
      return Promise.resolve({
        enabled: true,
        dryRun: true,
      });
    });

    await expect(scheduler.runScheduledScan()).resolves.not.toThrow();

    // Tenant 2 is still evaluated
    expect(mockRemindersService.evaluateTenantReminders).toHaveBeenCalledWith(
      'tenant_2',
      expect.any(Object),
    );
  });
});
