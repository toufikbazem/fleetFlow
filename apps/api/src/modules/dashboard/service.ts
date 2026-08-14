/**
 * Dashboard assembly — FF-901.
 *
 * **Why this route consults the matrix itself instead of using `authorize()`.**
 *
 * The dashboard is the one screen that spans modules. Its widgets are governed
 * by four different permissions, and a Mechanic who may read maintenance but not
 * reports must get the maintenance widgets and no cost figure — from one
 * request. A single `authorize(module, action)` cannot express that, so the
 * route authenticates and each section resolves its own scope here.
 *
 * The important part is that this uses exactly the same `can()` the middleware
 * uses. It is a different call site, not a second set of rules.
 */

import {
  can,
  type Dashboard,
  type DashboardCounter,
  type Module,
  type Notification,
} from '@fleetflow/shared';
import { DEFAULT_SETTINGS } from '@fleetflow/shared';
import type { Prisma } from '@prisma/client';
import { childLogger } from '../../platform/logger.js';
import { vehicleScope, type CallerIdentity, type CallerScope } from '../../platform/scope.js';
import { loadSettings } from '../../platform/settings.js';
import { loadNotificationSettings } from '../notifications/rules.js';
import { readCache, writeCache } from './cache.js';
import {
  documentCounts,
  maintenanceCounts,
  monthlyCost,
  recentNotifications,
  vehicleCounts,
} from './repository.js';

const log = childLogger('dashboard');

/**
 * The caller's scope for one module, or null if the matrix denies it.
 *
 * Denial is null rather than an exception: a Mechanic has no business seeing
 * fleet spend, and that is a normal shape of the response, not an error.
 */
function scopeFor(identity: CallerIdentity, module: Module): CallerScope | null {
  const decision = can(identity.role, module, 'read');
  if (!decision.allowed) return null;
  return { ...identity, scope: decision.scope };
}

function counter(value: number, filter: Record<string, string>): DashboardCounter {
  return { value, filter };
}

function toNotification(row: {
  id: string;
  rule: Notification['rule'];
  entityType: string;
  entityId: string;
  fireDate: Date;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}): Notification {
  return {
    id: row.id,
    rule: row.rule,
    entityType: row.entityType,
    entityId: row.entityId,
    fireDate: row.fireDate.toISOString().split('T')[0] ?? '',
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The eight widgets
// ---------------------------------------------------------------------------

async function buildDashboard(identity: CallerIdentity): Promise<Dashboard> {
  const vehiclesScope = scopeFor(identity, 'vehicles');
  const maintenanceScopeFor = scopeFor(identity, 'maintenance');
  const documentsScope = scopeFor(identity, 'documents');
  // DSH-08 is fleet spend. `reports` is the permission the matrix uses for
  // cost visibility, which is why an Accountant sees it and a Mechanic does not.
  const costAllowed = can(identity.role, 'reports', 'read').allowed;

  const notice = await loadNotificationSettings();
  // The same window the reminders use, so an email about a job due next week and
  // the "upcoming" counter can never describe different sets.
  const noticeDays = Math.max(...notice.maintenanceNoticeDays);

  const [vehicles, maintenance, documents, notifications, cost] = await Promise.all([
    vehiclesScope
      ? vehicleCounts((await vehicleScope(vehiclesScope)) satisfies Prisma.VehicleWhereInput)
      : null,
    maintenanceScopeFor
      ? maintenanceCounts(maintenanceScopeFor, noticeDays, notice.maintenanceNoticeKm)
      : null,
    documentsScope ? documentCounts(documentsScope) : null,
    recentNotifications(identity.userId),
    costAllowed ? monthlyCost() : null,
  ]);

  const settings = await loadSettings();
  const currency = settings.general.currency || DEFAULT_SETTINGS.general.currency;

  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    vehicles: vehicles
      ? {
          // No status filter: the vehicle list already hides archived vehicles
          // by default, which is the same set `total` counted.
          total: counter(vehicles.total, {}),
          active: counter(vehicles.active, { status: 'ACTIVE' }),
          underMaintenance: counter(vehicles.underMaintenance, { status: 'UNDER_MAINTENANCE' }),
        }
      : null,
    maintenance: maintenance
      ? {
          upcoming: counter(maintenance.upcoming, { due: 'upcoming' }),
          overdue: counter(maintenance.overdue, { due: 'overdue' }),
          preview: maintenance.preview,
          noticeDays,
        }
      : null,
    documents: documents
      ? {
          expiring: counter(documents.expiring, { status: 'EXPIRING_SOON' }),
          expired: counter(documents.expired, { status: 'EXPIRED' }),
          preview: documents.preview,
        }
      : null,
    recentNotifications: notifications.map(toNotification),
    cost: cost
      ? {
          currency,
          months: cost.months,
          total: cost.months.reduce((sum, month) => sum + month.total, 0),
          currentMonthTotal: cost.months.at(-1)?.total ?? 0,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The dashboard, from cache when possible.
 *
 * Keyed by role *and* user id. Role alone would be wrong for the two scoped
 * roles — two Drivers share a role and see different vehicles — and user id
 * alone would be wrong the moment an administrator changes somebody's role,
 * because USR-02's acceptance requires that to take effect on the next request.
 */
export async function getDashboard(identity: CallerIdentity): Promise<Dashboard> {
  const cached = await readCache(identity.role, identity.userId);
  if (cached) return { ...cached, cached: true };

  const started = Date.now();
  const dashboard = await buildDashboard(identity);
  const elapsed = Date.now() - started;

  // DSH's acceptance criterion is a full render in under two seconds. The cold
  // path is the one that misses it, so it is the one that gets measured — a
  // timing that only ever appears on the cached path proves nothing.
  log.info({ elapsedMs: elapsed, role: identity.role }, 'Dashboard computed');

  await writeCache(identity.role, identity.userId, dashboard);
  return dashboard;
}
