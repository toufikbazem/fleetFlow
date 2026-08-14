/**
 * Dashboard aggregates — FF-901.
 *
 * Eight widgets, five queries. The shape is deliberate: DSH's acceptance
 * criterion is a full render in under two seconds, and the way a dashboard
 * misses that target is not one slow query but twenty small ones, each cheap on
 * a seeded laptop and none cheap on 250 vehicles.
 *
 * **Three of the five are raw SQL, for the same reason the document list is.**
 * Two of the numbers on this screen compare a column against another table's
 * column — a maintenance op's `due_mileage` against its vehicle's
 * `current_mileage`, a document's `expiry_date` against its type's
 * `default_notice_days`. Prisma cannot express that, so the alternative is
 * fetching every open operation and filtering in memory, which is exactly the
 * shape that passes on demo data and falls over on the reference dataset.
 *
 * **Raw SQL bypasses the soft-delete extension.** Every statement below states
 * `deleted_at IS NULL` itself. This is the one place in the codebase where
 * forgetting it is possible, which is why it is written out at each site rather
 * than hidden in a helper that could be omitted silently.
 */

import {
  daysUntil,
  type DashboardCostMonth,
  type DashboardDocumentItem,
  type DashboardMaintenanceItem,
  type MaintenanceStatus,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { childLogger } from '../../platform/logger.js';
import { maintenanceScopeSql, vehicleScopeSql, type CallerScope } from '../../platform/scope.js';
import { bucketBaseSql, maintenanceBucketSql } from '../maintenance/due-buckets.js';
import { COST_BASIS_SQL } from '../reports/cost-basis.js';

const log = childLogger('dashboard');

/** How many rows each preview list carries. Enough to be useful, not a second list page. */
const PREVIEW_LIMIT = 5;

/** DSH-08 looks back a year, so a season-over-season comparison is possible. */
const COST_MONTHS = 12;

// ---------------------------------------------------------------------------
// DSH-01…03 — vehicles
// ---------------------------------------------------------------------------

export interface VehicleCounts {
  total: number;
  active: number;
  underMaintenance: number;
}

/**
 * One grouped count answers all three counters.
 *
 * `total` excludes archived vehicles on purpose: VEH-06's acceptance says
 * archiving removes a vehicle from operational lists, and a fleet total that
 * keeps counting sold vans is the number a manager would have to mentally
 * correct every time they read it.
 */
export async function vehicleCounts(where: Prisma.VehicleWhereInput): Promise<VehicleCounts> {
  const rows = await prisma.vehicle.groupBy({ by: ['status'], where, _count: { _all: true } });

  const byStatus = new Map(rows.map((row) => [row.status, row._count._all]));
  const active = byStatus.get('ACTIVE') ?? 0;
  const underMaintenance = byStatus.get('UNDER_MAINTENANCE') ?? 0;

  return { total: active + underMaintenance, active, underMaintenance };
}

// ---------------------------------------------------------------------------
// DSH-04, DSH-05 — maintenance
// ---------------------------------------------------------------------------

export interface MaintenanceCounts {
  upcoming: number;
  overdue: number;
  preview: DashboardMaintenanceItem[];
}

interface BucketRow {
  bucket: 'OVERDUE' | 'UPCOMING' | 'LATER';
  count: bigint;
}

interface MaintenanceRow {
  id: string;
  vehicle_id: string;
  plate: string;
  title: string;
  status: MaintenanceStatus;
  due_date: Date | null;
  due_mileage: number | null;
  current_mileage: number;
  bucket: 'OVERDUE' | 'UPCOMING' | 'LATER';
}

export async function maintenanceCounts(
  caller: CallerScope,
  noticeDays: number,
  noticeKm: number,
): Promise<MaintenanceCounts> {
  const bucket = maintenanceBucketSql(noticeDays, noticeKm);
  const base = bucketBaseSql(await maintenanceScopeSql(caller));

  const [buckets, preview] = await Promise.all([
    prisma.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT bucket, COUNT(*)::bigint AS count
      FROM (SELECT ${bucket} AS bucket ${base}) grouped
      GROUP BY bucket
    `),
    prisma.$queryRaw<MaintenanceRow[]>(Prisma.sql`
      SELECT m.id, m.vehicle_id, v.plate, m.title, m.status,
             m.due_date, m.due_mileage, v.current_mileage,
             ${bucket} AS bucket
      ${base}
      -- Overdue first, then soonest. NULLS LAST keeps mileage-only work, which
      -- has no due date, from monopolising the top of the list.
      ORDER BY (${bucket} = 'OVERDUE') DESC, m.due_date ASC NULLS LAST
      LIMIT ${PREVIEW_LIMIT}
    `),
  ]);

  const byBucket = new Map(buckets.map((row) => [row.bucket, Number(row.count)]));

  return {
    upcoming: byBucket.get('UPCOMING') ?? 0,
    overdue: byBucket.get('OVERDUE') ?? 0,
    preview: preview.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      plate: row.plate,
      title: row.title,
      // The bucket wins over the stored status, so the badge agrees with the
      // counter the item was listed under.
      status: row.bucket === 'OVERDUE' ? 'OVERDUE' : row.status,
      dueDate: row.due_date ? (row.due_date.toISOString().split('T')[0] ?? null) : null,
      dueMileage: row.due_mileage,
      currentMileage: row.current_mileage,
      daysUntilDue: row.due_date ? daysUntil(row.due_date) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// DSH-06 — documents
// ---------------------------------------------------------------------------

export interface DocumentCounts {
  expiring: number;
  expired: number;
  preview: DashboardDocumentItem[];
}

/** Identical to the expression in the document repository — DOC-05 has one definition. */
const DOCUMENT_STATUS_SQL = Prisma.sql`
  CASE
    WHEN d.expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN d.expiry_date - COALESCE(d.notice_days, dt.default_notice_days) <= CURRENT_DATE
      THEN 'EXPIRING_SOON'
    ELSE 'VALID'
  END
`;

interface DocumentStatusRow {
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  count: bigint;
}

interface DocumentPreviewRow {
  id: string;
  vehicle_id: string;
  plate: string;
  type_label: string;
  expiry_date: Date;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
}

export async function documentCounts(caller: CallerScope): Promise<DocumentCounts> {
  const scopeClause = await vehicleScopeSql(caller, Prisma.sql`d.vehicle_id`);

  // Archived vehicles are excluded: their paperwork lapsing is not an
  // operational problem, and leaving them in makes the counter grow forever as
  // vehicles retire.
  const base = Prisma.sql`
    FROM documents d
    JOIN document_types dt ON dt.id = d.document_type_id
    JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND v.status <> 'ARCHIVED'
      AND ${scopeClause}
  `;

  const [counts, preview] = await Promise.all([
    prisma.$queryRaw<DocumentStatusRow[]>(Prisma.sql`
      SELECT status, COUNT(*)::bigint AS count
      FROM (SELECT ${DOCUMENT_STATUS_SQL} AS status ${base}) grouped
      GROUP BY status
    `),
    prisma.$queryRaw<DocumentPreviewRow[]>(Prisma.sql`
      SELECT d.id, d.vehicle_id, v.plate, dt.label AS type_label, d.expiry_date,
             ${DOCUMENT_STATUS_SQL} AS status
      ${base}
        AND ${DOCUMENT_STATUS_SQL} <> 'VALID'
      ORDER BY d.expiry_date ASC
      LIMIT ${PREVIEW_LIMIT}
    `),
  ]);

  const byStatus = new Map(counts.map((row) => [row.status, Number(row.count)]));

  return {
    expiring: byStatus.get('EXPIRING_SOON') ?? 0,
    expired: byStatus.get('EXPIRED') ?? 0,
    preview: preview.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      plate: row.plate,
      typeLabel: row.type_label,
      expiryDate: row.expiry_date.toISOString().split('T')[0] ?? '',
      status: row.status,
      daysUntilExpiry: daysUntil(row.expiry_date),
    })),
  };
}

// ---------------------------------------------------------------------------
// DSH-08 — monthly maintenance cost
// ---------------------------------------------------------------------------

interface CostRow {
  month: string;
  total: string;
  operations: bigint;
  currencies: bigint;
}

/**
 * Completed maintenance spend by month.
 *
 * What counts as spend is `COST_BASIS_SQL`, shared with both cost reports —
 * RPT-06 requires exported figures to reconcile with this chart, and two
 * predicates that merely look alike would eventually stop being alike.
 *
 * Decimal totals come back as strings from Postgres. They are parsed once here
 * rather than passed along, so the client never has to decide how to add money.
 */
export async function monthlyCost(months: number = COST_MONTHS): Promise<{
  months: DashboardCostMonth[];
  mixedCurrency: boolean;
}> {
  const rows = await prisma.$queryRaw<CostRow[]>(Prisma.sql`
    SELECT to_char(date_trunc('month', m.completed_at), 'YYYY-MM') AS month,
           COALESCE(SUM(m.cost_total), 0)::text AS total,
           COUNT(*)::bigint AS operations,
           COUNT(DISTINCT m.currency)::bigint AS currencies
    FROM maintenance_ops m
    WHERE ${COST_BASIS_SQL}
      AND m.completed_at >= date_trunc('month', CURRENT_DATE) - make_interval(months => ${months - 1}::int)
    GROUP BY 1
    ORDER BY 1
  `);

  const byMonth = new Map(
    rows.map((row) => [
      row.month,
      { month: row.month, total: Number(row.total), operations: Number(row.operations) },
    ]),
  );

  // Zero-fill. A month with no spend is a real answer; a gap in a bar chart
  // reads as missing data, and the two must not look the same.
  const filled: DashboardCostMonth[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() - (months - 1));

  for (let index = 0; index < months; index += 1) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    filled.push(byMonth.get(key) ?? { month: key, total: 0, operations: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Summing across currencies would produce a confident, meaningless number.
  // The MVP is single-currency (settings.general.currency); this makes the
  // assumption audible rather than silently wrong if it ever stops holding.
  const mixedCurrency = rows.some((row) => Number(row.currencies) > 1);
  if (mixedCurrency) {
    log.warn('Maintenance costs span multiple currencies; the monthly total is not meaningful');
  }

  return { months: filled, mixedCurrency };
}

// ---------------------------------------------------------------------------
// DSH-07 — recent notifications
// ---------------------------------------------------------------------------

export async function recentNotifications(userId: string, take: number = PREVIEW_LIMIT) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}
