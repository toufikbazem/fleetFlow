/**
 * Notification rules — FF-802 (NTF-01…04).
 *
 * Four triggers, evaluated against the notice periods the client agreed (Q4)
 * and stored in `settings` — so tuning them is an administrator's edit, not a
 * redeployment.
 *
 * `now` is a parameter throughout. Every date comparison here is the kind that
 * is trivially wrong at a month boundary or in the wrong timezone, and a fixed
 * clock is the only way to demonstrate otherwise.
 */

import {
  OPEN_MAINTENANCE_STATUSES,
  type NotificationRule,
  type NotificationRunResult,
  type Settings,
} from '@fleetflow/shared';
import { prisma } from '../../platform/db.js';
import { loadEnv } from '../../platform/env.js';
import { childLogger } from '../../platform/logger.js';
import { loadSettingsBranch } from '../../platform/settings.js';
import {
  createRecipientCache,
  insertNotifications,
  resolveRecipients,
  type PendingNotification,
} from './recipients.js';

const env = loadEnv();
const log = childLogger('notification-rules');

const DAY_MS = 86_400_000;

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dateOnly(value: Date): string {
  return value.toISOString().split('T')[0] ?? '';
}

function link(path: string): string {
  return new URL(path, env.appUrl).toString();
}

/**
 * Reads the tunable values, falling back to the agreed defaults.
 *
 * A missing or malformed settings row must not stop the run: reminders that
 * silently stop because somebody saved bad JSON is the exact failure this
 * feature exists to prevent.
 */
export async function loadNotificationSettings(): Promise<Settings['notifications']> {
  return loadSettingsBranch('notifications');
}

interface RuleOutcome {
  rule: NotificationRule;
  matched: number;
  pending: PendingNotification[];
}

// ---------------------------------------------------------------------------
// NTF-01 — maintenance coming due
// ---------------------------------------------------------------------------

async function maintenanceUpcoming(
  today: Date,
  settings: Settings['notifications'],
  cache: ReturnType<typeof createRecipientCache>,
): Promise<RuleOutcome> {
  // The widest configured threshold defines the window; a job inside it is
  // announced once, and NTF-07 stops it being announced again tomorrow.
  const widestDays = Math.max(...settings.maintenanceNoticeDays);
  const horizon = addDays(today, widestDays);

  const jobs = await prisma.maintenanceOp.findMany({
    where: {
      status: { in: ['PLANNED', 'IN_PROGRESS'] },
      OR: [
        { dueDate: { gte: today, lte: horizon } },
        // Mileage-triggered work has no due date; the vehicle's odometer is
        // compared against the threshold instead.
        { dueMileage: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      dueMileage: true,
      mechanicId: true,
      vehicleId: true,
      vehicle: { select: { plate: true, currentMileage: true } },
    },
  });

  const pending: PendingNotification[] = [];
  let matched = 0;

  for (const job of jobs) {
    const dateDue = job.dueDate !== null && job.dueDate >= today && job.dueDate <= horizon;
    const mileageDue =
      job.dueMileage !== null &&
      job.vehicle.currentMileage + settings.maintenanceNoticeKm >= job.dueMileage &&
      job.vehicle.currentMileage < job.dueMileage;

    if (!dateDue && !mileageDue) continue;
    matched += 1;

    const when = job.dueDate
      ? `due ${dateOnly(job.dueDate)}`
      : `due at ${job.dueMileage?.toLocaleString('en-US')} km (currently ${job.vehicle.currentMileage.toLocaleString('en-US')} km)`;

    const recipients = await resolveRecipients(
      {
        roles: ['FLEET_MANAGER'],
        includeVehicleDriver: true,
        mechanicId: job.mechanicId,
        vehicleId: job.vehicleId,
      },
      cache,
    );

    for (const userId of recipients) {
      pending.push({
        userId,
        rule: 'MAINTENANCE_UPCOMING',
        entityType: 'maintenance_op',
        entityId: job.id,
        title: `Maintenance due soon — ${job.vehicle.plate}`,
        body: `"${job.title}" on ${job.vehicle.plate} is ${when}.`,
        linkUrl: link(`/maintenance?vehicleId=${job.vehicleId}`),
      });
    }
  }

  return { rule: 'MAINTENANCE_UPCOMING', matched, pending };
}

// ---------------------------------------------------------------------------
// NTF-04 — maintenance not done on time
// ---------------------------------------------------------------------------

async function maintenanceOverdue(
  today: Date,
  cache: ReturnType<typeof createRecipientCache>,
): Promise<RuleOutcome> {
  const jobs = await prisma.maintenanceOp.findMany({
    where: { status: { in: [...OPEN_MAINTENANCE_STATUSES] } },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      dueMileage: true,
      mechanicId: true,
      vehicleId: true,
      vehicle: { select: { plate: true, currentMileage: true } },
    },
  });

  const pending: PendingNotification[] = [];
  let matched = 0;

  for (const job of jobs) {
    const pastDate = job.dueDate !== null && job.dueDate < today;
    const pastMileage = job.dueMileage !== null && job.vehicle.currentMileage >= job.dueMileage;

    if (!pastDate && !pastMileage) continue;
    matched += 1;

    const recipients = await resolveRecipients(
      {
        roles: ['ADMIN', 'FLEET_MANAGER'],
        mechanicId: job.mechanicId,
        vehicleId: job.vehicleId,
      },
      cache,
    );

    const overdueBy = pastDate
      ? `${Math.round((today.getTime() - (job.dueDate as Date).getTime()) / DAY_MS)} days overdue`
      : `${(job.vehicle.currentMileage - (job.dueMileage as number)).toLocaleString('en-US')} km past its service point`;

    for (const userId of recipients) {
      pending.push({
        userId,
        rule: 'MAINTENANCE_OVERDUE',
        entityType: 'maintenance_op',
        entityId: job.id,
        title: `Overdue maintenance — ${job.vehicle.plate}`,
        body: `"${job.title}" on ${job.vehicle.plate} is ${overdueBy} and has not been completed.`,
        linkUrl: link(`/maintenance?status=OVERDUE`),
      });
    }
  }

  return { rule: 'MAINTENANCE_OVERDUE', matched, pending };
}

// ---------------------------------------------------------------------------
// NTF-02 and NTF-03 — documents, and inspections specifically
// ---------------------------------------------------------------------------

/**
 * One query serves both rules.
 *
 * NTF-03 (vehicle inspection) is a document expiry whose type happens to be the
 * technical inspection, and it goes to the driver as well because they are the
 * one who will be stopped at the roadside. Splitting the query would mean two
 * passes over the same rows and two chances for the definitions to drift.
 */
async function documentsExpiring(
  today: Date,
  settings: Settings['notifications'],
  cache: ReturnType<typeof createRecipientCache>,
): Promise<RuleOutcome[]> {
  const widestDays = Math.max(...settings.documentNoticeDays);
  const horizon = addDays(today, widestDays);

  const documents = await prisma.document.findMany({
    where: { expiryDate: { gte: today, lte: horizon } },
    select: {
      id: true,
      expiryDate: true,
      noticeDays: true,
      vehicleId: true,
      vehicle: { select: { plate: true, status: true } },
      documentType: { select: { code: true, label: true, defaultNoticeDays: true } },
    },
  });

  const expiring: PendingNotification[] = [];
  const inspections: PendingNotification[] = [];
  let expiringMatched = 0;
  let inspectionMatched = 0;

  for (const document of documents) {
    // Archived vehicles are not operated, so their paperwork is not urgent.
    if (document.vehicle.status === 'ARCHIVED') continue;

    const noticeDays = document.noticeDays ?? document.documentType.defaultNoticeDays;
    const daysLeft = Math.round((document.expiryDate.getTime() - today.getTime()) / DAY_MS);
    if (daysLeft > noticeDays) continue;

    const isInspection = document.documentType.code === 'technical_inspection';
    const rule: NotificationRule = isInspection ? 'INSPECTION_DUE' : 'DOCUMENT_EXPIRING';

    if (isInspection) inspectionMatched += 1;
    else expiringMatched += 1;

    const recipients = await resolveRecipients(
      {
        roles: ['ADMIN', 'FLEET_MANAGER'],
        // NTF-03: the driver is the one who gets stopped, so they are told too.
        includeVehicleDriver: isInspection,
        vehicleId: document.vehicleId,
      },
      cache,
    );

    for (const userId of recipients) {
      const item: PendingNotification = {
        userId,
        rule,
        entityType: 'document',
        entityId: document.id,
        title: isInspection
          ? `Inspection due — ${document.vehicle.plate}`
          : `${document.documentType.label} expiring — ${document.vehicle.plate}`,
        body:
          daysLeft === 0
            ? `The ${document.documentType.label.toLowerCase()} for ${document.vehicle.plate} expires today.`
            : `The ${document.documentType.label.toLowerCase()} for ${document.vehicle.plate} expires in ${daysLeft} days, on ${dateOnly(document.expiryDate)}.`,
        linkUrl: link(`/documents?vehicleId=${document.vehicleId}`),
      };

      if (isInspection) inspections.push(item);
      else expiring.push(item);
    }
  }

  return [
    { rule: 'DOCUMENT_EXPIRING', matched: expiringMatched, pending: expiring },
    { rule: 'INSPECTION_DUE', matched: inspectionMatched, pending: inspections },
  ];
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface RunOptions {
  now?: Date;
  /** Restricts the run to one rule, for diagnosis. */
  only?: NotificationRule;
}

/**
 * Evaluates every rule and records what should be sent.
 *
 * Returns the ids created, so the caller can queue exactly those for email —
 * anything suppressed as a duplicate was emailed on an earlier run.
 */
export async function evaluateRules(options: RunOptions = {}): Promise<{
  result: Omit<NotificationRunResult, 'emailsQueued' | 'emailEnabled'>;
  createdIds: string[];
}> {
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  const settings = await loadNotificationSettings();

  // One cache for the whole run: every rule asks the same "who are the fleet
  // managers?" question, and every document on a vehicle asks the same "who
  // drives it?". Without this the run issues a query per matched entity and
  // takes tens of seconds on a real fleet.
  const cache = createRecipientCache();

  const outcomes: RuleOutcome[] = [
    await maintenanceUpcoming(today, settings, cache),
    await maintenanceOverdue(today, cache),
    ...(await documentsExpiring(today, settings, cache)),
  ].filter((outcome) => !options.only || outcome.rule === options.only);

  const byRule: NotificationRunResult['byRule'] = [];
  const createdIds: string[] = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const outcome of outcomes) {
    const inserted = await insertNotifications(outcome.pending, today);
    byRule.push({
      rule: outcome.rule,
      matched: outcome.matched,
      created: inserted.created,
      skippedDuplicate: inserted.skippedDuplicate,
    });
    createdIds.push(...inserted.createdIds);
    totalCreated += inserted.created;
    totalSkipped += inserted.skippedDuplicate;
  }

  log.info(
    { totalCreated, totalSkipped, fireDate: dateOnly(today) },
    'Notification rules evaluated',
  );

  return {
    result: {
      ranAt: now.toISOString(),
      fireDate: dateOnly(today),
      byRule,
      totalCreated,
      totalSkipped,
    },
    createdIds,
  };
}
