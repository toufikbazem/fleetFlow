/**
 * Formatting — FF-1104.
 *
 * Formatting, not translation. Decision Q7 fixed the interface at English only,
 * so there is no i18n layer and no message catalogue. What remains is genuine:
 * a cost shown as "1234.5" on one screen and "$1,234.50" on another is the kind
 * of inconsistency that makes an accountant distrust the whole report.
 *
 * Currency and locale come from the server's `settings` (Q8), so an installation
 * can change them without a rebuild. Until the settings endpoint lands they fall
 * back to the seeded defaults.
 */

const DEFAULTS = { locale: 'en-US', currency: 'USD' } as const;

let locale: string = DEFAULTS.locale;
let currency: string = DEFAULTS.currency;

/** Applied once, when the app loads settings from the API. */
export function configureFormatting(options: { locale?: string; currency?: string }): void {
  if (options.locale) locale = options.locale;
  if (options.currency) currency = options.currency;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Costs arrive as strings, because they are Postgres `decimal` values.
 *
 * Prisma serialises them as strings rather than JS numbers deliberately: a
 * float cannot represent every two-decimal value exactly, and a report that
 * quietly rounds is worse than one that fails loudly. They are parsed here at
 * the last possible moment, for display only.
 */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

/** Odometer readings. The unit is part of the value to a fleet manager. */
export function formatMileage(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(locale).format(value)} km`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Date-only values (`YYYY-MM-DD`) are parsed as UTC midnight and formatted in
 * UTC, so an expiry of 2026-08-19 never displays as the 18th for a user west of
 * Greenwich. Timestamps keep local formatting, because "when did this happen"
 * is a local question.
 */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';

  const isDateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(isDateOnly ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * "in 12 days" / "6 days ago" — the phrasing the expiry and overdue screens
 * need, where the gap matters more than the date.
 */
export function formatRelativeDays(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const days = Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';

  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
}

/** Turns an enum-ish constant into something a person reads. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}
