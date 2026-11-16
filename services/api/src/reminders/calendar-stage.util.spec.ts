import { describe, it, expect } from 'vitest';
import {
  calculateDaysUntilDue,
  classifyReminderStage,
  getInvoiceReminderStage,
  getTenantLocalDate,
  parseInvoiceDueCalendarDate,
  calendarDaysBetween,
  isValidTimezone,
} from './calendar-stage.util.js';

describe('calendar-stage.util', () => {
  describe('1. Timezone Validation', () => {
    it('validates supported and unsupported timezones', () => {
      expect(isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);

      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
      expect(isValidTimezone(null as any)).toBe(false);
      expect(isValidTimezone(undefined as any)).toBe(false);
    });
  });

  describe('2. Date Classification Table Tests', () => {
    // Tests required by Phase 2B specification
    const testCases: Array<{ daysUntilDue: number; expected: string | null }> = [
      { daysUntilDue: 180, expected: null },
      { daysUntilDue: 60, expected: null },
      { daysUntilDue: 30, expected: null },
      { daysUntilDue: 4, expected: null },
      { daysUntilDue: 3, expected: 'DUE_SOON' },
      { daysUntilDue: 2, expected: 'DUE_SOON' },
      { daysUntilDue: 1, expected: 'DUE_SOON' },
      { daysUntilDue: 0, expected: 'DUE_TODAY' },
      { daysUntilDue: -1, expected: 'OVERDUE_STAGE_1' },
      { daysUntilDue: -7, expected: 'OVERDUE_STAGE_1' },
      { daysUntilDue: -8, expected: 'OVERDUE_STAGE_2' },
      { daysUntilDue: -21, expected: 'OVERDUE_STAGE_2' },
      { daysUntilDue: -22, expected: 'OVERDUE_STAGE_3' },
      { daysUntilDue: -60, expected: 'OVERDUE_STAGE_3' },
    ];

    testCases.forEach(({ daysUntilDue, expected }) => {
      it(`classifies daysUntilDue = ${daysUntilDue} as ${expected}`, () => {
        expect(classifyReminderStage(daysUntilDue)).toBe(expected);
      });
    });

    it('returns null for NaN or non-finite numbers', () => {
      expect(classifyReminderStage(NaN)).toBeNull();
      expect(classifyReminderStage(Infinity)).toBeNull();
      expect(classifyReminderStage(-Infinity)).toBeNull();
    });
  });

  describe('3. Calendar Days Between', () => {
    it('accurately computes calendar day differences regardless of time of year', () => {
      expect(calendarDaysBetween('2026-11-16', '2026-11-19')).toBe(3);
      expect(calendarDaysBetween('2026-11-16', '2026-11-16')).toBe(0);
      expect(calendarDaysBetween('2026-11-16', '2026-11-15')).toBe(-1);
      expect(calendarDaysBetween('2026-11-16', '2026-10-17')).toBe(-30);
      expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
    });

    it('handles leap years correctly', () => {
      // 2024 is a leap year (29 days in February)
      expect(calendarDaysBetween('2024-02-28', '2024-03-01')).toBe(2);
      // 2025 is not a leap year (28 days in February)
      expect(calendarDaysBetween('2025-02-28', '2025-03-01')).toBe(1);
    });
  });

  describe('4. Invoice Due Date Semantics & Normalization', () => {
    it('preserves date-only strings without shifting', () => {
      expect(parseInvoiceDueCalendarDate('2026-11-20', 'Asia/Kolkata')).toBe('2026-11-20');
      expect(parseInvoiceDueCalendarDate('2026-11-20', 'America/New_York')).toBe('2026-11-20');
      expect(parseInvoiceDueCalendarDate('2026-11-20', 'UTC')).toBe('2026-11-20');
    });

    it('preserves UTC midnight timestamps as the date-only business calendar date', () => {
      const utcMidnight = new Date('2026-11-20T00:00:00.000Z');
      expect(parseInvoiceDueCalendarDate(utcMidnight, 'Asia/Kolkata')).toBe('2026-11-20');
      expect(parseInvoiceDueCalendarDate(utcMidnight, 'America/New_York')).toBe('2026-11-20');
      expect(parseInvoiceDueCalendarDate(utcMidnight, 'UTC')).toBe('2026-11-20');
    });

    it('resolves timestamps with non-midnight components to tenant timezone calendar date', () => {
      // 2026-11-20 14:50:48 UTC
      const afternoonUtc = new Date('2026-11-20T14:50:48.545Z');
      // In Asia/Kolkata (+5:30), 14:50 + 5:30 = 20:20 on Nov 20
      expect(parseInvoiceDueCalendarDate(afternoonUtc, 'Asia/Kolkata')).toBe('2026-11-20');
      // In America/New_York (EST, -5:00), 14:50 - 5:00 = 09:50 on Nov 20
      expect(parseInvoiceDueCalendarDate(afternoonUtc, 'America/New_York')).toBe('2026-11-20');
      // In UTC, 14:50 on Nov 20
      expect(parseInvoiceDueCalendarDate(afternoonUtc, 'UTC')).toBe('2026-11-20');

      // 2026-11-20 03:30:00 UTC
      const earlyMorningUtc = new Date('2026-11-20T03:30:00.000Z');
      // In Asia/Kolkata (+5:30), 03:30 + 5:30 = 09:00 on Nov 20
      expect(parseInvoiceDueCalendarDate(earlyMorningUtc, 'Asia/Kolkata')).toBe('2026-11-20');
      // In America/New_York (EST, -5:00), 03:30 - 5:00 = 22:30 on Nov 19
      expect(parseInvoiceDueCalendarDate(earlyMorningUtc, 'America/New_York')).toBe('2026-11-19');
    });

    it('returns null for invalid due dates or unrecognized timezones', () => {
      expect(parseInvoiceDueCalendarDate('invalid-date', 'Asia/Kolkata')).toBeNull();
      expect(parseInvoiceDueCalendarDate(new Date('invalid'), 'Asia/Kolkata')).toBeNull();
      expect(parseInvoiceDueCalendarDate('2026-11-20', 'Bad/Timezone')).toBeNull();
    });
  });

  describe('5. Timezone & Midnight Boundary Scenarios', () => {
    it('evaluates Asia/Kolkata correctly around UTC midnight', () => {
      // UTC midnight: 2026-11-20T00:00:00.000Z
      // In Asia/Kolkata (+5:30), this is 2026-11-20 05:30:00 IST (morning of Nov 20)
      const nowAtUtcMidnight = new Date('2026-11-20T00:00:00.000Z');
      expect(getTenantLocalDate(nowAtUtcMidnight, 'Asia/Kolkata')).toBe('2026-11-20');

      // Invoice due on Nov 20 evaluated at UTC midnight in IST:
      expect(calculateDaysUntilDue('2026-11-20', nowAtUtcMidnight, 'Asia/Kolkata')).toBe(0);
      expect(getInvoiceReminderStage('2026-11-20', nowAtUtcMidnight, 'Asia/Kolkata')).toBe('DUE_TODAY');

      // Late evening in UTC: 2026-11-19T20:00:00.000Z
      // In Asia/Kolkata (+5:30), this is 2026-11-20 01:30:00 IST (already past midnight in India!)
      const nowAtLateUtc = new Date('2026-11-19T20:00:00.000Z');
      expect(getTenantLocalDate(nowAtLateUtc, 'Asia/Kolkata')).toBe('2026-11-20');
      expect(getInvoiceReminderStage('2026-11-20', nowAtLateUtc, 'Asia/Kolkata')).toBe('DUE_TODAY');
    });

    it('evaluates UTC around midnight correctly', () => {
      const nowPreMidnight = new Date('2026-11-19T23:59:59.000Z');
      expect(getTenantLocalDate(nowPreMidnight, 'UTC')).toBe('2026-11-19');
      expect(getInvoiceReminderStage('2026-11-20', nowPreMidnight, 'UTC')).toBe('DUE_SOON'); // 1 day until due

      const nowPostMidnight = new Date('2026-11-20T00:00:01.000Z');
      expect(getTenantLocalDate(nowPostMidnight, 'UTC')).toBe('2026-11-20');
      expect(getInvoiceReminderStage('2026-11-20', nowPostMidnight, 'UTC')).toBe('DUE_TODAY');
    });

    it('evaluates America/New_York around midnight correctly', () => {
      // Midnight in New York (EST, UTC-5) occurs at 05:00:00 UTC
      // At 04:30:00 UTC on Nov 20, in New York it is 23:30:00 on Nov 19
      const nowBeforeNyMidnight = new Date('2026-11-20T04:30:00.000Z');
      expect(getTenantLocalDate(nowBeforeNyMidnight, 'America/New_York')).toBe('2026-11-19');
      expect(getInvoiceReminderStage('2026-11-20', nowBeforeNyMidnight, 'America/New_York')).toBe('DUE_SOON'); // 1 day until due

      // At 05:30:00 UTC on Nov 20, in New York it is 00:30:00 on Nov 20 (past midnight)
      const nowAfterNyMidnight = new Date('2026-11-20T05:30:00.000Z');
      expect(getTenantLocalDate(nowAfterNyMidnight, 'America/New_York')).toBe('2026-11-20');
      expect(getInvoiceReminderStage('2026-11-20', nowAfterNyMidnight, 'America/New_York')).toBe('DUE_TODAY');
    });

    it('handles daylight-saving transitions in America/New_York cleanly', () => {
      // Spring forward: 2026-03-08 (clocks skip 2:00 -> 3:00)
      const springTransition = new Date('2026-03-08T12:00:00.000Z');
      expect(getTenantLocalDate(springTransition, 'America/New_York')).toBe('2026-03-08');

      // Invoice due on 2026-03-10 evaluated on 2026-03-08:
      // Even with 23-hour day on transition date, calendar day difference is exactly 2:
      expect(calculateDaysUntilDue('2026-03-10', springTransition, 'America/New_York')).toBe(2);
      expect(getInvoiceReminderStage('2026-03-10', springTransition, 'America/New_York')).toBe('DUE_SOON');

      // Fall back: 2026-11-01 (clocks repeat 1:00 -> 1:00, 25-hour day)
      const fallTransition = new Date('2026-11-01T12:00:00.000Z');
      expect(getTenantLocalDate(fallTransition, 'America/New_York')).toBe('2026-11-01');
      expect(calculateDaysUntilDue('2026-11-03', fallTransition, 'America/New_York')).toBe(2);
      expect(getInvoiceReminderStage('2026-11-03', fallTransition, 'America/New_York')).toBe('DUE_SOON');
    });
  });

  describe('6. Safety & Invalid Input Handling', () => {
    it('returns null and does not produce an eligible reminder on invalid date', () => {
      expect(calculateDaysUntilDue('invalid-date', new Date(), 'Asia/Kolkata')).toBeNull();
      expect(getInvoiceReminderStage('invalid-date', new Date(), 'Asia/Kolkata')).toBeNull();
      expect(getInvoiceReminderStage(new Date(), 'invalid-date', 'Asia/Kolkata')).toBeNull();
    });

    it('returns null on invalid timezone identifier', () => {
      expect(calculateDaysUntilDue('2026-11-20', new Date(), 'Unsupported/Timezone')).toBeNull();
      expect(getInvoiceReminderStage('2026-11-20', new Date(), 'Unsupported/Timezone')).toBeNull();
    });
  });
});
