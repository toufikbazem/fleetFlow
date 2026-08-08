/**
 * Domain rules that both sides need to agree on.
 *
 * Not schemas — these are the small calculations where an API/UI disagreement
 * would be visible to a user as a contradiction: a badge saying "valid" next to
 * a list headed "expiring soon".
 */

import type { DamageStatus, DocumentStatus, MaintenanceStatus, VehicleStatus } from './enums.js';

// ---------------------------------------------------------------------------
// Documents — DOC-05
// ---------------------------------------------------------------------------

/** Midnight UTC, so a date-only value is compared against a date, not a moment. */
function startOfDayUtc(value: Date | string): number {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const DAY_MS = 86_400_000;

/**
 * Derives valid / expiring soon / expired.
 *
 * The status is never stored — a stored value is wrong the moment the clock
 * passes midnight with no write to the row. It is computed in SQL for lists and
 * here for anything the client renders, and the two must agree, which is why
 * this lives in the shared package rather than in either app.
 */
export function deriveDocumentStatus(
  expiryDate: Date | string,
  effectiveNoticeDays: number,
  today: Date = new Date(),
): DocumentStatus {
  const expiry = startOfDayUtc(expiryDate);
  const now = startOfDayUtc(today);

  if (expiry < now) return 'EXPIRED';
  if (expiry - now <= effectiveNoticeDays * DAY_MS) return 'EXPIRING_SOON';
  return 'VALID';
}

export function daysUntil(date: Date | string, today: Date = new Date()): number {
  return Math.round((startOfDayUtc(date) - startOfDayUtc(today)) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Vehicles — VEH-06
// ---------------------------------------------------------------------------

/**
 * Legal status transitions.
 *
 * ARCHIVED is a one-way door from the operational states, and returning from it
 * is deliberately allowed: a vehicle taken off the road for a season comes back,
 * and forcing someone to re-create it would lose its entire history.
 */
export const VEHICLE_TRANSITIONS: Readonly<Record<VehicleStatus, readonly VehicleStatus[]>> = {
  ACTIVE: ['UNDER_MAINTENANCE', 'ARCHIVED'],
  UNDER_MAINTENANCE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
} as const;

export function canTransitionVehicle(from: VehicleStatus, to: VehicleStatus): boolean {
  if (from === to) return true;
  return VEHICLE_TRANSITIONS[from].includes(to);
}

/** Statuses that belong in day-to-day lists. Archived vehicles are excluded. */
export const OPERATIONAL_VEHICLE_STATUSES: readonly VehicleStatus[] = [
  'ACTIVE',
  'UNDER_MAINTENANCE',
];

/** Wording used in error messages, so the API and the UI phrase it identically. */
export function humaniseVehicleStatus(status: VehicleStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'UNDER_MAINTENANCE':
      return 'under maintenance';
    case 'ARCHIVED':
      return 'archived';
  }
}

// ---------------------------------------------------------------------------
// Damages — DMG
// ---------------------------------------------------------------------------

/**
 * Legal status transitions for a damage report.
 *
 * LINKED is deliberately absent from every list: it is not something anyone
 * sets by hand. A report becomes LINKED only by being converted into a
 * maintenance job (DMG-02), because the status asserts that a job exists — and
 * a status that can claim a job which does not exist is worse than no status.
 *
 * RESOLVED and REJECTED are terminal. Reopening would let a report drift back
 * into the queue after a decision was recorded against it; filing a new report
 * is the honest way to raise the same problem again.
 */
export const DAMAGE_TRANSITIONS: Readonly<Record<DamageStatus, readonly DamageStatus[]>> = {
  REPORTED: ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'],
  UNDER_REVIEW: ['RESOLVED', 'REJECTED'],
  LINKED: ['RESOLVED'],
  RESOLVED: [],
  REJECTED: [],
} as const;

export function canTransitionDamage(from: DamageStatus, to: DamageStatus): boolean {
  if (from === to) return true;
  return DAMAGE_TRANSITIONS[from].includes(to);
}

/** Reports still needing a decision — the fleet manager's triage queue. */
export const OPEN_DAMAGE_STATUSES: readonly DamageStatus[] = ['REPORTED', 'UNDER_REVIEW', 'LINKED'];

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** Work that is still outstanding — drives the "upcoming" and overdue views. */
export const OPEN_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  'PLANNED',
  'IN_PROGRESS',
  'OVERDUE',
];
