import type { ReminderStage } from './reminders.types.js';

/**
 * Validates whether an IANA timezone identifier is recognized by the runtime.
 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts a Date or ISO date/timestamp string into a 'YYYY-MM-DD' calendar date string
 * in the specified timezone.
 * Returns null if the date or timezone is invalid.
 */
export function getTenantLocalDate(
  dateInput: Date | string,
  timezone: string,
): string | null {
  if (!isValidTimezone(timezone)) return null;

  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone.trim(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return null;
  }
}

/**
 * Resolves an invoice due date to a canonical 'YYYY-MM-DD' calendar date.
 *
 * Invoice Due-Date Storage Semantics:
 * 1. Date-only strings ('YYYY-MM-DD') represent an unambiguous business calendar date.
 * 2. Due dates stored at UTC midnight ('YYYY-MM-DDT00:00:00.000Z') originated from date-only
 *    form inputs and represent the business calendar date specified by the date portion.
 * 3. Timestamps with non-midnight time components (e.g. from seed scripts, offset arithmetic,
 *    or time-specific entries) represent an instant in time and are resolved to a calendar date
 *    in the tenant's configured timezone.
 *
 * Returns null if the due date is invalid or timezone is unrecognized.
 */
export function parseInvoiceDueCalendarDate(
  dueDateInput: Date | string,
  timezone: string,
): string | null {
  if (!isValidTimezone(timezone)) return null;

  if (typeof dueDateInput === 'string') {
    const trimmed = dueDateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(`${trimmed}T00:00:00.000Z`);
      return isNaN(parsed.getTime()) ? null : trimmed;
    }
  }

  const date = typeof dueDateInput === 'string' ? new Date(dueDateInput) : dueDateInput;
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }

  // If the stored timestamp is exactly UTC midnight, it represents a date-only business calendar date
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return date.toISOString().slice(0, 10);
  }

  // For timestamps with non-midnight components, interpret in the tenant timezone
  return getTenantLocalDate(date, timezone);
}

/**
 * Calculates the exact integer number of calendar days between two 'YYYY-MM-DD' strings.
 * Result = toDate - fromDate.
 * Uses UTC date conversion to guarantee immunity to Daylight Saving Time (DST) 23h/25h shifts.
 */
export function calendarDaysBetween(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * Calculates daysUntilDue following the canonical convention:
 *   daysUntilDue = invoiceDueCalendarDay - tenantToday
 *
 * Convention:
 * - Positive: Invoice is due in the future (e.g., +3 means due in 3 days).
 * - Zero: Invoice is due today (due date matches tenant's local calendar date).
 * - Negative: Invoice is overdue (e.g., -1 means 1 day overdue, -7 means 7 days overdue).
 *
 * Returns null if the due date, current date, or timezone is invalid.
 */
export function calculateDaysUntilDue(
  dueDate: Date | string,
  now: Date | string,
  timezone: string,
): number | null {
  const dueCalendarDay = parseInvoiceDueCalendarDate(dueDate, timezone);
  const tenantToday = getTenantLocalDate(now, timezone);

  if (!dueCalendarDay || !tenantToday) {
    return null;
  }

  return calendarDaysBetween(tenantToday, dueCalendarDay);
}

/**
 * Maps daysUntilDue to the standardized reminder escalation stage.
 *
 * Stage Boundaries:
 * | daysUntilDue     | Result          | Description                        |
 * |------------------|-----------------|------------------------------------|
 * | > 3              | null            | Outside reminder horizon (skip)    |
 * | 3, 2, 1          | DUE_SOON        | Due in 1 to 3 days                 |
 * | 0                | DUE_TODAY       | Due on tenant's current day        |
 * | -1 through -7    | OVERDUE_STAGE_1 | 1 to 7 days overdue                |
 * | -8 through -21   | OVERDUE_STAGE_2 | 8 to 21 days overdue               |
 * | < -21            | OVERDUE_STAGE_3 | 22+ days overdue                   |
 *
 * @param daysUntilDue Number of calendar days until the invoice is due.
 * @param upcomingWindowDays Horizon for DUE_SOON classification (default: 3 days).
 */
export function classifyReminderStage(
  daysUntilDue: number,
  upcomingWindowDays: number = 3,
): ReminderStage | null {
  if (isNaN(daysUntilDue) || !isFinite(daysUntilDue)) {
    return null;
  }

  if (daysUntilDue > upcomingWindowDays) {
    return null;
  }

  if (daysUntilDue >= 1) {
    return 'DUE_SOON';
  }

  if (daysUntilDue === 0) {
    return 'DUE_TODAY';
  }

  if (daysUntilDue >= -7) {
    return 'OVERDUE_STAGE_1';
  }

  if (daysUntilDue >= -21) {
    return 'OVERDUE_STAGE_2';
  }

  return 'OVERDUE_STAGE_3';
}

/**
 * End-to-end evaluation of an invoice due date against the tenant's current calendar date.
 * Returns the active ReminderStage or null if the invoice is outside the upcoming window
 * or if date/timezone inputs are invalid.
 */
export function getInvoiceReminderStage(
  dueDate: Date | string,
  now: Date | string,
  timezone: string,
  upcomingWindowDays: number = 3,
): ReminderStage | null {
  const daysUntilDue = calculateDaysUntilDue(dueDate, now, timezone);
  if (daysUntilDue === null) {
    return null;
  }
  return classifyReminderStage(daysUntilDue, upcomingWindowDays);
}
