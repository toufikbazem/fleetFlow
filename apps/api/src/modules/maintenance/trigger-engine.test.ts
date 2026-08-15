/**
 * Trigger engine arithmetic — FF-1206 (MNT-02).
 *
 * `nextDueDate` and `nextDueMileage` are the two functions in the product whose
 * failure is completely silent. A reminder that never fires looks exactly like a
 * fleet with nothing due: no error, no empty state, no log line. The engine's
 * side effects are covered by the integration suite; this covers the arithmetic,
 * where the interesting failures are off-by-one and unbounded catch-up.
 *
 * `today` is a parameter, which is what makes any of this testable. A function
 * that reads the clock internally can only be tested by mocking global time,
 * and a suite that does that passes in the morning and fails at 23:30 UTC.
 */

import { describe, expect, it } from 'vitest';
import { nextDueDate, nextDueMileage } from './trigger-engine.js';

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const at = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

describe('nextDueDate', () => {
  it('returns the baseline when it is still in the future', () => {
    expect(iso(nextDueDate(at('2026-12-01'), 365, at('2026-08-14')))).toBe('2026-12-01');
  });

  it('returns the baseline when it falls exactly today', () => {
    expect(iso(nextDueDate(at('2026-08-14'), 90, at('2026-08-14')))).toBe('2026-08-14');
  });

  it('advances one interval when the baseline has just passed', () => {
    expect(iso(nextDueDate(at('2026-08-13'), 90, at('2026-08-14')))).toBe('2026-11-11');
  });

  /**
   * The bounded-catch-up property, and the reason this function exists.
   *
   * A van bought four years ago on an annual plan, with no recorded history,
   * must produce *the next* inspection — not four overdue ones. Four rows of
   * noise nobody can act on is how the one real job gets buried.
   */
  it('produces exactly one future date from a four-year-old baseline', () => {
    const result = nextDueDate(at('2022-03-01'), 365, at('2026-08-14'));
    expect(result.getTime()).toBeGreaterThanOrEqual(at('2026-08-14').getTime());
    // And it is the *first* such date: stepping back one interval lands before today.
    const previous = new Date(result.getTime() - 365 * 86_400_000);
    expect(previous.getTime()).toBeLessThan(at('2026-08-14').getTime());
  });

  it('lands on today rather than skipping it when the cycle divides exactly', () => {
    // Baseline 90 days back on a 90-day plan: due is today, not 90 days out.
    expect(iso(nextDueDate(at('2026-05-16'), 90, at('2026-08-14')))).toBe('2026-08-14');
  });

  it('always returns a date at or after today', () => {
    // Property check across a spread of intervals and baselines — the invariant
    // that matters is "never in the past", regardless of alignment.
    const today = at('2026-08-14');
    for (const interval of [1, 7, 14, 30, 90, 180, 365]) {
      for (const baseline of ['2019-01-01', '2024-02-29', '2026-08-13', '2026-08-14']) {
        const result = nextDueDate(at(baseline), interval, today);
        expect(result.getTime()).toBeGreaterThanOrEqual(today.getTime());
      }
    }
  });

  it('ignores the time of day in either argument', () => {
    const lateBaseline = new Date('2026-08-13T23:59:00.000Z');
    const earlyToday = new Date('2026-08-14T00:00:01.000Z');
    expect(iso(nextDueDate(lateBaseline, 90, earlyToday))).toBe('2026-11-11');
  });

  it('handles a daily interval without drifting', () => {
    expect(iso(nextDueDate(at('2026-08-01'), 1, at('2026-08-14')))).toBe('2026-08-14');
  });

  it('crosses a leap day by counting real days', () => {
    // 2028-02-29 exists. 365 days from 2028-01-01 is 2028-12-31, not 2029-01-01.
    expect(iso(nextDueDate(at('2028-01-01'), 365, at('2028-06-01')))).toBe('2028-12-31');
  });
});

describe('nextDueMileage', () => {
  it('adds one interval to the last completed service', () => {
    expect(nextDueMileage(84_500, 15_000, 80_000)).toBe(95_000);
  });

  /**
   * The no-history case, and the one that is easy to get wrong.
   *
   * A van already on 84 500 km with a 15 000 km plan is next due at 90 000 —
   * not at 15 000, which is in the past and would generate an instantly overdue
   * job on the day the plan is created.
   */
  it('rounds up to the next multiple when there is no history', () => {
    expect(nextDueMileage(84_500, 15_000, null)).toBe(90_000);
  });

  it('never returns a milestone at or below the current reading', () => {
    for (const current of [0, 1, 14_999, 15_000, 15_001, 999_999]) {
      expect(nextDueMileage(current, 15_000, null)).toBeGreaterThan(current);
    }
  });

  it('steps past an exact multiple rather than returning it', () => {
    // At exactly 30 000 km the service is due now, so the *next* one is 45 000.
    // Returning 30 000 would create a job that is due at the reading which
    // triggered it, and re-trigger on the following run.
    expect(nextDueMileage(30_000, 15_000, null)).toBe(45_000);
  });

  it('handles a brand-new vehicle', () => {
    expect(nextDueMileage(0, 15_000, null)).toBe(15_000);
  });

  it('trusts recorded history even when it is behind the odometer', () => {
    // Mileage was recorded late: the last service was at 80 000 but the van has
    // since reached 98 000. The next service is overdue, and saying so is right —
    // silently skipping to 110 000 would hide a genuinely missed service.
    expect(nextDueMileage(98_000, 15_000, 80_000)).toBe(95_000);
  });
});
