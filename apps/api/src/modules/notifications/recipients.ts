/**
 * Recipient resolution and de-duplicated insertion — FF-801.
 *
 * **NTF-07 is a database constraint, not code here.**
 *
 * `UNIQUE (user_id, rule, entity_type, entity_id, fire_date)` was created in
 * FF-103. This module inserts with `skipDuplicates`, which Prisma compiles to
 * `ON CONFLICT DO NOTHING` — so "one notification per rule, per entity, per
 * day" holds even if the job is retried after a crash, run twice concurrently,
 * or triggered by hand during UAT.
 *
 * That last case is the one that matters. A tester pressing "run now" four
 * times is exactly when a naive implementation sends four emails to every
 * manager in the company, and exactly when they stop trusting the feature.
 */

import type { NotificationRule } from '@fleetflow/shared';
import { prisma } from '../../platform/db.js';
import { childLogger } from '../../platform/logger.js';

const log = childLogger('notifications');

export interface PendingNotification {
  userId: string;
  rule: NotificationRule;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  linkUrl: string | null;
}

export interface InsertResult {
  created: number;
  skippedDuplicate: number;
  /** Ids of the rows actually created, so only those are emailed. */
  createdIds: string[];
}

/**
 * Inserts, skipping anything already sent today.
 *
 * The created rows are read back rather than assumed: `createMany` reports a
 * count, not which rows survived the conflict, and emailing the wrong set would
 * either double-send or silently drop.
 */
export async function insertNotifications(
  pending: PendingNotification[],
  fireDate: Date,
): Promise<InsertResult> {
  if (pending.length === 0) return { created: 0, skippedDuplicate: 0, createdIds: [] };

  // Taken before the insert, so the read-back below can identify this run's
  // rows by time. One millisecond of slack absorbs clock granularity between
  // the application and the database.
  const startedAt = new Date(Date.now() - 1);

  const result = await prisma.notification.createMany({
    data: pending.map((item) => ({
      userId: item.userId,
      rule: item.rule,
      entityType: item.entityType,
      entityId: item.entityId,
      fireDate,
      title: item.title,
      body: item.body,
      linkUrl: item.linkUrl,
    })),
    // ON CONFLICT DO NOTHING against the NTF-07 unique index.
    skipDuplicates: true,
  });

  const skippedDuplicate = pending.length - result.count;

  /**
   * Read back only what this call created — `createMany` reports a count, not
   * which rows survived the conflict, and emailing the wrong set would either
   * double-send or silently drop.
   *
   * **By timestamp, not by key.** This used to build an `OR` of one clause per
   * pending notification. On the reference fleet that is over nine thousand
   * branches in a single query, and it turned a daily job into something that
   * took more than half a minute. `created_at >= startedAt` identifies the same
   * rows with an indexed range scan.
   *
   * Rows created by a concurrent run in the same window would also match, and
   * that is harmless: NTF-07's unique index means only one run can have created
   * any given row, and `deliveries: none` excludes anything already emailed.
   */
  const createdIds =
    result.count === 0
      ? []
      : (
          await prisma.notification.findMany({
            where: {
              fireDate,
              createdAt: { gte: startedAt },
              // Anything already delivered belongs to a previous run.
              deliveries: { none: {} },
            },
            select: { id: true },
          })
        ).map((row) => row.id);

  if (skippedDuplicate > 0) {
    log.info({ skippedDuplicate, created: result.count }, 'Duplicate notifications suppressed');
  }

  return { created: result.count, skippedDuplicate, createdIds };
}

// ---------------------------------------------------------------------------
// Who hears about what
// ---------------------------------------------------------------------------

interface RecipientQuery {
  /** Roles that always hear about this rule, fleet-wide. */
  roles: Array<'ADMIN' | 'FLEET_MANAGER' | 'ACCOUNTANT'>;
  /** Include the driver currently holding the vehicle. */
  includeVehicleDriver?: boolean;
  /** Include the mechanic assigned to the job, if there is one. */
  mechanicId?: string | null;
  vehicleId?: string;
}

/**
 * Per-run memoisation — FF-1208.
 *
 * `resolveRecipients` is called once per matched entity, and on the reference
 * fleet the rules match several hundred. Each call issued two or three queries,
 * and every one of them asked the same two questions: "who are the fleet
 * managers?" (identical every time) and "who drives vehicle X?" (identical for
 * every document and job on that vehicle). The daily run took over twenty
 * seconds on 250 vehicles and would have grown linearly.
 *
 * The cache is per run rather than global on purpose. A long-lived cache of
 * "who is an administrator" would keep emailing somebody after their account
 * was deactivated, and the whole run takes seconds — there is nothing to gain
 * by holding it longer than that.
 */
class RecipientCache {
  private readonly byRoles = new Map<string, string[]>();
  private readonly byVehicle = new Map<string, string | null>();
  private readonly byMechanic = new Map<string, boolean>();

  async rolesToUsers(roles: readonly string[]): Promise<string[]> {
    const key = [...roles].sort().join(',');
    const cached = this.byRoles.get(key);
    if (cached) return cached;

    const users = await prisma.user.findMany({
      where: { role: { in: roles as RecipientQuery['roles'] }, isActive: true },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    this.byRoles.set(key, ids);
    return ids;
  }

  /** The user id of the driver currently holding this vehicle, if they have an account. */
  async vehicleDriver(vehicleId: string): Promise<string | null> {
    if (this.byVehicle.has(vehicleId)) return this.byVehicle.get(vehicleId) ?? null;

    const assignment = await prisma.assignment.findFirst({
      where: { vehicleId, endDate: null },
      select: { driver: { select: { userId: true, deletedAt: true } } },
    });
    // Only a driver with a login account can receive anything; most drivers
    // have none (DRV-04), and that is not an error.
    const candidate = assignment?.driver.deletedAt === null ? assignment.driver.userId : null;

    let resolved: string | null = null;
    if (candidate) {
      const user = await prisma.user.findFirst({
        where: { id: candidate, isActive: true },
        select: { id: true },
      });
      resolved = user?.id ?? null;
    }
    this.byVehicle.set(vehicleId, resolved);
    return resolved;
  }

  async isActiveUser(userId: string): Promise<boolean> {
    const cached = this.byMechanic.get(userId);
    if (cached !== undefined) return cached;

    const user = await prisma.user.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true },
    });
    const active = user !== null;
    this.byMechanic.set(userId, active);
    return active;
  }
}

export function createRecipientCache(): RecipientCache {
  return new RecipientCache();
}

/**
 * Resolves the people who should hear about one event.
 *
 * Two rules, from plan §1.6 and the client's answer to Q4:
 *
 *   by role          administrators and fleet managers see fleet-wide events
 *   by relationship  the driver holding the vehicle, and the mechanic assigned
 *                    to the job, hear about their own work
 *
 * Deactivated and deleted accounts are excluded by the soft-delete extension
 * plus an explicit `isActive` check — emailing somebody who left the company is
 * both useless and a small data leak.
 *
 * Pass a cache when resolving many events in one run; without one it falls back
 * to a private cache and behaves exactly as before, one entity at a time.
 */
export async function resolveRecipients(
  query: RecipientQuery,
  cache: RecipientCache = createRecipientCache(),
): Promise<string[]> {
  const ids = new Set<string>();

  if (query.roles.length > 0) {
    for (const id of await cache.rolesToUsers(query.roles)) ids.add(id);
  }

  if (query.includeVehicleDriver && query.vehicleId) {
    const driverUserId = await cache.vehicleDriver(query.vehicleId);
    if (driverUserId) ids.add(driverUserId);
  }

  if (query.mechanicId && (await cache.isActiveUser(query.mechanicId))) {
    ids.add(query.mechanicId);
  }

  return [...ids];
}

/** Addresses for a set of notifications, for the email step. */
export async function loadRecipientEmails(notificationIds: string[]): Promise<
  Array<{
    notificationId: string;
    email: string;
    name: string;
    title: string;
    body: string;
    linkUrl: string | null;
  }>
> {
  if (notificationIds.length === 0) return [];

  const rows = await prisma.notification.findMany({
    where: { id: { in: notificationIds } },
    select: {
      id: true,
      title: true,
      body: true,
      linkUrl: true,
      user: { select: { email: true, name: true, isActive: true } },
    },
  });

  return rows
    .filter((row) => row.user.isActive)
    .map((row) => ({
      notificationId: row.id,
      email: row.user.email,
      name: row.user.name,
      title: row.title,
      body: row.body,
      linkUrl: row.linkUrl,
    }));
}
