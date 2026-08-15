/**
 * Domain rules — FF-1206 (DOC-05, VEH-06, DMG, MNT-06).
 *
 * These are the calculations whose failure is invisible. A document status that
 * is wrong by one day produces no error, no empty screen and no log line — it
 * produces a fleet manager who is told their insurance is valid on the morning
 * it expires. Every case below is therefore a boundary, not a happy path.
 *
 * The clock is a parameter throughout, which is the only reason these can be
 * tested at all: a suite that calls `new Date()` internally passes in the
 * morning and fails at 23:30 UTC, and gets marked flaky rather than fixed.
 */

import { describe, expect, it } from 'vitest';
import {
  canTransitionDamage,
  canTransitionVehicle,
  DAMAGE_TRANSITIONS,
  daysUntil,
  deriveDocumentStatus,
  humaniseVehicleStatus,
  OPEN_DAMAGE_STATUSES,
  OPEN_MAINTENANCE_STATUSES,
  OPERATIONAL_VEHICLE_STATUSES,
  VEHICLE_TRANSITIONS,
} from './domain.js';
import { canTransitionMaintenance, DAMAGE_STATUSES, VEHICLE_STATUSES } from './enums.js';

/** A fixed clock. Chosen mid-month and mid-year so no boundary is accidental. */
const TODAY = new Date('2026-08-14T00:00:00.000Z');

describe('deriveDocumentStatus — DOC-05', () => {
  const NOTICE = 30;

  it('is VALID well beyond the notice window', () => {
    expect(deriveDocumentStatus('2027-08-14', NOTICE, TODAY)).toBe('VALID');
  });

  it('is EXPIRING_SOON exactly on the notice boundary', () => {
    // 30 days out with a 30-day notice: the day the warning is meant to start.
    // An off-by-one here costs a full day of the notice period.
    expect(deriveDocumentStatus('2026-09-13', NOTICE, TODAY)).toBe('EXPIRING_SOON');
  });

  it('is VALID one day outside the notice boundary', () => {
    expect(deriveDocumentStatus('2026-09-14', NOTICE, TODAY)).toBe('VALID');
  });

  it('is EXPIRING_SOON on the day it expires, not EXPIRED', () => {
    // A document is valid *through* its expiry date. Calling it expired a day
    // early would ground a vehicle that is legally fine to drive.
    expect(deriveDocumentStatus('2026-08-14', NOTICE, TODAY)).toBe('EXPIRING_SOON');
  });

  it('is EXPIRED the day after it expires', () => {
    expect(deriveDocumentStatus('2026-08-13', NOTICE, TODAY)).toBe('EXPIRED');
  });

  it('ignores the time of day on the clock', () => {
    // The status must not change between 00:01 and 23:59 on the same date.
    const morning = new Date('2026-08-14T00:01:00.000Z');
    const night = new Date('2026-08-14T23:59:59.000Z');
    expect(deriveDocumentStatus('2026-08-14', NOTICE, morning)).toBe(
      deriveDocumentStatus('2026-08-14', NOTICE, night),
    );
  });

  it('accepts a Date as readily as a string', () => {
    expect(deriveDocumentStatus(new Date('2026-08-13T00:00:00.000Z'), NOTICE, TODAY)).toBe(
      'EXPIRED',
    );
  });

  it('handles a zero notice period without warning early', () => {
    expect(deriveDocumentStatus('2026-08-15', 0, TODAY)).toBe('VALID');
    expect(deriveDocumentStatus('2026-08-14', 0, TODAY)).toBe('EXPIRING_SOON');
  });

  it('crosses a month boundary correctly', () => {
    const endOfMonth = new Date('2026-08-31T00:00:00.000Z');
    expect(deriveDocumentStatus('2026-09-01', 1, endOfMonth)).toBe('EXPIRING_SOON');
    expect(deriveDocumentStatus('2026-08-30', 1, endOfMonth)).toBe('EXPIRED');
  });

  it('crosses a year boundary correctly', () => {
    const newYearsEve = new Date('2026-12-31T00:00:00.000Z');
    expect(deriveDocumentStatus('2027-01-01', 7, newYearsEve)).toBe('EXPIRING_SOON');
    expect(deriveDocumentStatus('2027-03-01', 7, newYearsEve)).toBe('VALID');
  });

  it('survives a leap day', () => {
    // 2028 is a leap year. Feb 29 exists, and arithmetic that assumes 365-day
    // years drifts by a day here.
    const leapDay = new Date('2028-02-29T00:00:00.000Z');
    expect(deriveDocumentStatus('2028-02-29', 0, leapDay)).toBe('EXPIRING_SOON');
    expect(deriveDocumentStatus('2028-03-01', 1, leapDay)).toBe('EXPIRING_SOON');
  });
});

describe('daysUntil', () => {
  it('is zero today, positive in the future, negative in the past', () => {
    expect(daysUntil('2026-08-14', TODAY)).toBe(0);
    expect(daysUntil('2026-08-15', TODAY)).toBe(1);
    expect(daysUntil('2026-08-13', TODAY)).toBe(-1);
  });

  it('counts calendar days across a month boundary', () => {
    expect(daysUntil('2026-09-01', TODAY)).toBe(18);
  });

  it('is unaffected by a daylight-saving shift', () => {
    // Europe/London moves on 25 Oct 2026. Naive local-time arithmetic across
    // that boundary yields 30.958… days, which rounds to the wrong integer in
    // half the cases. UTC-based arithmetic gives exactly 31.
    expect(daysUntil('2026-11-14', TODAY)).toBe(92);
    const beforeShift = new Date('2026-10-24T00:00:00.000Z');
    expect(daysUntil('2026-10-26', beforeShift)).toBe(2);
  });
});

describe('vehicle transitions — VEH-06', () => {
  it('allows the operational round trip', () => {
    expect(canTransitionVehicle('ACTIVE', 'UNDER_MAINTENANCE')).toBe(true);
    expect(canTransitionVehicle('UNDER_MAINTENANCE', 'ACTIVE')).toBe(true);
  });

  it('allows archiving from either operational state', () => {
    expect(canTransitionVehicle('ACTIVE', 'ARCHIVED')).toBe(true);
    expect(canTransitionVehicle('UNDER_MAINTENANCE', 'ARCHIVED')).toBe(true);
  });

  it('allows an archived vehicle back, but only to ACTIVE', () => {
    // Deliberate: a van off the road for a season comes back, and re-creating it
    // would lose its history. Straight to UNDER_MAINTENANCE is not a real move.
    expect(canTransitionVehicle('ARCHIVED', 'ACTIVE')).toBe(true);
    expect(canTransitionVehicle('ARCHIVED', 'UNDER_MAINTENANCE')).toBe(false);
  });

  it('treats a no-op as legal', () => {
    for (const status of VEHICLE_STATUSES) {
      expect(canTransitionVehicle(status, status)).toBe(true);
    }
  });

  it('never lists a status as a transition to itself', () => {
    // Self-transitions are handled by the `from === to` short circuit; listing
    // them in the table too would mean two sources of truth for the same rule.
    for (const [from, targets] of Object.entries(VEHICLE_TRANSITIONS)) {
      expect(targets).not.toContain(from);
    }
  });

  it('has a phrase for every status', () => {
    for (const status of VEHICLE_STATUSES) {
      expect(humaniseVehicleStatus(status)).toMatch(/^[a-z ]+$/);
    }
  });

  it('excludes archived vehicles from operational lists', () => {
    expect(OPERATIONAL_VEHICLE_STATUSES).not.toContain('ARCHIVED');
  });
});

describe('damage transitions — DMG', () => {
  it('lets a report be triaged, resolved or rejected', () => {
    expect(canTransitionDamage('REPORTED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionDamage('REPORTED', 'RESOLVED')).toBe(true);
    expect(canTransitionDamage('REPORTED', 'REJECTED')).toBe(true);
  });

  it('never allows LINKED to be set by hand', () => {
    // LINKED asserts that a maintenance job exists (DMG-02). A status that can
    // claim a job which does not exist is worse than no status at all.
    for (const from of DAMAGE_STATUSES) {
      expect(DAMAGE_TRANSITIONS[from]).not.toContain('LINKED');
    }
  });

  it('keeps RESOLVED and REJECTED terminal', () => {
    expect(DAMAGE_TRANSITIONS.RESOLVED).toHaveLength(0);
    expect(DAMAGE_TRANSITIONS.REJECTED).toHaveLength(0);
    expect(canTransitionDamage('REJECTED', 'REPORTED')).toBe(false);
    expect(canTransitionDamage('RESOLVED', 'UNDER_REVIEW')).toBe(false);
  });

  it('lets linked work be resolved once the job is done', () => {
    expect(canTransitionDamage('LINKED', 'RESOLVED')).toBe(true);
    expect(canTransitionDamage('LINKED', 'REJECTED')).toBe(false);
  });

  it('keeps the triage queue and the terminal states disjoint', () => {
    expect(OPEN_DAMAGE_STATUSES).not.toContain('RESOLVED');
    expect(OPEN_DAMAGE_STATUSES).not.toContain('REJECTED');
  });
});

describe('maintenance transitions — MNT-06', () => {
  it('keeps COMPLETED terminal', () => {
    // Correcting a mistaken completion is an edit of the record, not a status
    // change, so the completion history stays honest.
    expect(canTransitionMaintenance('COMPLETED', 'PLANNED')).toBe(false);
    expect(canTransitionMaintenance('COMPLETED', 'IN_PROGRESS')).toBe(false);
  });

  it('lets overdue work still be started and finished late', () => {
    expect(canTransitionMaintenance('OVERDUE', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionMaintenance('OVERDUE', 'COMPLETED')).toBe(true);
  });

  it('does not let anything go back to PLANNED', () => {
    expect(canTransitionMaintenance('IN_PROGRESS', 'PLANNED')).toBe(false);
    expect(canTransitionMaintenance('OVERDUE', 'PLANNED')).toBe(false);
  });

  it('excludes COMPLETED from the open set', () => {
    expect(OPEN_MAINTENANCE_STATUSES).not.toContain('COMPLETED');
  });
});
