/**
 * The five reports — FF-1001 (RPT-01…05, RPT-07).
 *
 * Each report is a function from filters to a `{ columns, rows, totals, total }`
 * table. They share one signature so the route, the paginator and all three
 * serialisers are written once — see the note at the top of the shared
 * `reports.ts` for why that is the load-bearing decision here.
 *
 * **Everything is raw SQL, and that is not incidental.** Four of the five
 * aggregate; three of them must count rows whose *vehicle* has been archived or
 * soft-deleted, which the Prisma extension exists to hide. Writing these through
 * the query builder would mean either fetching history into memory to aggregate
 * it, or quietly dropping the archived vehicles that history is mostly about.
 *
 * Because raw SQL bypasses the soft-delete extension, every statement states its
 * own `deleted_at` policy — and the policy differs per report on purpose, which
 * is exactly why it is written out at each site rather than hidden in a helper.
 */

import type { ReportColumn, ReportFilter, ReportName, ReportRow } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { costPeriodSql } from './cost-basis.js';

export interface ReportTable {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  total: number;
}

export interface ReportSlice {
  /** Omitted for exports, which cover the whole filtered set. */
  offset?: number;
  limit?: number;
}

export interface ReportDefinition {
  name: ReportName;
  title: string;
  description: string;
  supportedFilters: Array<'from' | 'to' | 'vehicleId' | 'driverId'>;
  run(filter: ReportFilter, slice: ReportSlice): Promise<ReportTable>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateOnly(value: Date | null): string | null {
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

/** Postgres returns DECIMAL as a string and COUNT as a bigint; neither is JSON. */
function money(value: string | null): number {
  return value === null ? 0 : Number(value);
}

function count(value: bigint | null): number {
  return value === null ? 0 : Number(value);
}

/** "1 vehicle" / "2 vehicles". A totals row reading "1 vehicles" undermines the figures beside it. */
function plural(quantity: number, singular: string, pluralForm = `${singular}s`): string {
  return `${quantity.toLocaleString('en-US')} ${quantity === 1 ? singular : pluralForm}`;
}

function paginate(slice: ReportSlice): Prisma.Sql {
  if (slice.limit === undefined) return Prisma.empty;
  return Prisma.sql`LIMIT ${slice.limit} OFFSET ${slice.offset ?? 0}`;
}

/**
 * A vehicle filter that also matches soft-deleted vehicles.
 *
 * Reports are history. Filtering to one vehicle must keep working after that
 * vehicle is archived or removed, or the report answering "what did this van
 * cost us" stops answering it precisely when someone asks.
 */
function vehicleFilter(filter: ReportFilter, column: Prisma.Sql): Prisma.Sql {
  return filter.vehicleId ? Prisma.sql`AND ${column} = ${filter.vehicleId}::uuid` : Prisma.empty;
}

// ---------------------------------------------------------------------------
// RPT-01 — vehicle maintenance history
// ---------------------------------------------------------------------------

interface HistoryRow {
  completed_at: Date | null;
  due_date: Date | null;
  plate: string;
  make: string;
  model: string;
  title: string;
  kind: string;
  status: string;
  mechanic: string | null;
  vendor: string | null;
  cost_parts: string;
  cost_labour: string;
  cost_total: string;
}

const maintenanceHistory: ReportDefinition = {
  name: 'maintenance-history',
  title: 'Vehicle maintenance history',
  description: 'Every maintenance operation recorded, newest first.',
  supportedFilters: ['from', 'to', 'vehicleId'],

  async run(filter, slice) {
    // The range is applied to the date the reader cares about: when the work was
    // done if it is finished, when it is due if it is not. Using `completed_at`
    // alone would make a range containing only open work come back empty.
    const effectiveDate = Prisma.sql`COALESCE(m.completed_at::date, m.due_date)`;

    const conditions: Prisma.Sql[] = [Prisma.sql`m.deleted_at IS NULL`];
    if (filter.from) conditions.push(Prisma.sql`${effectiveDate} >= ${filter.from}::date`);
    if (filter.to) conditions.push(Prisma.sql`${effectiveDate} <= ${filter.to}::date`);

    // No `v.deleted_at IS NULL`: a removed vehicle's history is still history.
    const base = Prisma.sql`
      FROM maintenance_ops m
      JOIN vehicles v ON v.id = m.vehicle_id
      LEFT JOIN users u ON u.id = m.mechanic_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ${vehicleFilter(filter, Prisma.sql`m.vehicle_id`)}
    `;

    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
        SELECT m.completed_at, m.due_date, v.plate, v.make, v.model,
               m.title, m.kind, m.status, u.name AS mechanic, m.vendor,
               m.cost_parts::text, m.cost_labour::text, m.cost_total::text
        ${base}
        ORDER BY ${effectiveDate} DESC NULLS LAST, v.plate ASC
        ${paginate(slice)}
      `),
      // Totals over the whole filtered set, not over the page — a footer that
      // sums only what is on screen is the commonest way a report misleads.
      prisma.$queryRaw<[{ rows: bigint; parts: string; labour: string; total: string }]>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS rows,
                 COALESCE(SUM(m.cost_parts), 0)::text  AS parts,
                 COALESCE(SUM(m.cost_labour), 0)::text AS labour,
                 COALESCE(SUM(m.cost_total), 0)::text  AS total
          ${base}
        `,
      ),
    ]);

    const [totals] = summary;

    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'plate', label: 'Vehicle', type: 'text' },
        { key: 'vehicleName', label: 'Make & model', type: 'text' },
        { key: 'title', label: 'Operation', type: 'text' },
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'mechanic', label: 'Mechanic', type: 'text' },
        { key: 'vendor', label: 'Vendor', type: 'text' },
        { key: 'parts', label: 'Parts', type: 'money' },
        { key: 'labour', label: 'Labour', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
      ],
      rows: rows.map((row) => ({
        date: dateOnly(row.completed_at) ?? dateOnly(row.due_date),
        plate: row.plate,
        vehicleName: `${row.make} ${row.model}`,
        title: row.title,
        kind: row.kind,
        status: row.status,
        mechanic: row.mechanic,
        vendor: row.vendor,
        parts: money(row.cost_parts),
        labour: money(row.cost_labour),
        total: money(row.cost_total),
      })),
      totals: {
        date: null,
        plate: null,
        vehicleName: null,
        title: plural(count(totals?.rows ?? null), 'operation'),
        kind: null,
        status: null,
        mechanic: null,
        vendor: null,
        parts: money(totals?.parts ?? null),
        labour: money(totals?.labour ?? null),
        total: money(totals?.total ?? null),
      },
      total: count(totals?.rows ?? null),
    };
  },
};

// ---------------------------------------------------------------------------
// RPT-02 — maintenance cost per vehicle
// ---------------------------------------------------------------------------

interface CostByVehicleRow {
  vehicle_id: string;
  plate: string;
  make: string;
  model: string;
  status: string;
  operations: bigint;
  parts: string;
  labour: string;
  total: string;
  last_completed: Date | null;
}

const costByVehicle: ReportDefinition = {
  name: 'cost-by-vehicle',
  title: 'Maintenance cost per vehicle',
  description: 'Completed maintenance spend, grouped by vehicle.',
  supportedFilters: ['from', 'to', 'vehicleId'],

  async run(filter, slice) {
    const base = Prisma.sql`
      FROM maintenance_ops m
      JOIN vehicles v ON v.id = m.vehicle_id
      WHERE ${costPeriodSql(filter.from, filter.to)}
      ${vehicleFilter(filter, Prisma.sql`m.vehicle_id`)}
    `;

    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<CostByVehicleRow[]>(Prisma.sql`
        SELECT v.id AS vehicle_id, v.plate, v.make, v.model, v.status,
               COUNT(*)::bigint AS operations,
               SUM(m.cost_parts)::text  AS parts,
               SUM(m.cost_labour)::text AS labour,
               SUM(m.cost_total)::text  AS total,
               MAX(m.completed_at) AS last_completed
        ${base}
        GROUP BY v.id, v.plate, v.make, v.model, v.status
        ORDER BY SUM(m.cost_total) DESC
        ${paginate(slice)}
      `),
      // COUNT(DISTINCT) rather than the row count: the page total is a number of
      // vehicles, and the grand total must be a number of vehicles too.
      prisma.$queryRaw<[{ vehicles: bigint; parts: string; labour: string; total: string }]>(
        Prisma.sql`
          SELECT COUNT(DISTINCT v.id)::bigint AS vehicles,
                 COALESCE(SUM(m.cost_parts), 0)::text  AS parts,
                 COALESCE(SUM(m.cost_labour), 0)::text AS labour,
                 COALESCE(SUM(m.cost_total), 0)::text  AS total
          ${base}
        `,
      ),
    ]);

    const [totals] = summary;

    return {
      columns: [
        { key: 'plate', label: 'Vehicle', type: 'text' },
        { key: 'vehicleName', label: 'Make & model', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'operations', label: 'Operations', type: 'integer' },
        { key: 'parts', label: 'Parts', type: 'money' },
        { key: 'labour', label: 'Labour', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'lastCompleted', label: 'Last serviced', type: 'date' },
      ],
      rows: rows.map((row) => ({
        plate: row.plate,
        vehicleName: `${row.make} ${row.model}`,
        status: row.status,
        operations: count(row.operations),
        parts: money(row.parts),
        labour: money(row.labour),
        total: money(row.total),
        lastCompleted: dateOnly(row.last_completed),
      })),
      totals: {
        plate: plural(count(totals?.vehicles ?? null), 'vehicle'),
        vehicleName: null,
        status: null,
        operations: null,
        parts: money(totals?.parts ?? null),
        labour: money(totals?.labour ?? null),
        total: money(totals?.total ?? null),
        lastCompleted: null,
      },
      total: count(totals?.vehicles ?? null),
    };
  },
};

// ---------------------------------------------------------------------------
// RPT-03 — maintenance cost by period
// ---------------------------------------------------------------------------

interface CostByPeriodRow {
  month: string;
  operations: bigint;
  vehicles: bigint;
  parts: string;
  labour: string;
  total: string;
}

const costByPeriod: ReportDefinition = {
  name: 'cost-by-period',
  title: 'Maintenance cost by period',
  description: 'Completed maintenance spend, grouped by calendar month.',
  supportedFilters: ['from', 'to', 'vehicleId'],

  async run(filter, slice) {
    // This is the report RPT-06 requires to reconcile with the dashboard chart,
    // so it uses the same basis and the same monthly bucketing.
    const base = Prisma.sql`
      FROM maintenance_ops m
      WHERE ${costPeriodSql(filter.from, filter.to)}
      ${vehicleFilter(filter, Prisma.sql`m.vehicle_id`)}
    `;

    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<CostByPeriodRow[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', m.completed_at), 'YYYY-MM') AS month,
               COUNT(*)::bigint AS operations,
               COUNT(DISTINCT m.vehicle_id)::bigint AS vehicles,
               SUM(m.cost_parts)::text  AS parts,
               SUM(m.cost_labour)::text AS labour,
               SUM(m.cost_total)::text  AS total
        ${base}
        GROUP BY 1
        ORDER BY 1 DESC
        ${paginate(slice)}
      `),
      prisma.$queryRaw<
        [{ months: bigint; operations: bigint; parts: string; labour: string; total: string }]
      >(Prisma.sql`
        SELECT COUNT(DISTINCT date_trunc('month', m.completed_at))::bigint AS months,
               COUNT(*)::bigint AS operations,
               COALESCE(SUM(m.cost_parts), 0)::text  AS parts,
               COALESCE(SUM(m.cost_labour), 0)::text AS labour,
               COALESCE(SUM(m.cost_total), 0)::text  AS total
        ${base}
      `),
    ]);

    const [totals] = summary;

    return {
      columns: [
        { key: 'month', label: 'Month', type: 'text' },
        { key: 'operations', label: 'Operations', type: 'integer' },
        { key: 'vehicles', label: 'Vehicles', type: 'integer' },
        { key: 'parts', label: 'Parts', type: 'money' },
        { key: 'labour', label: 'Labour', type: 'money' },
        { key: 'total', label: 'Total', type: 'money' },
      ],
      rows: rows.map((row) => ({
        month: row.month,
        operations: count(row.operations),
        vehicles: count(row.vehicles),
        parts: money(row.parts),
        labour: money(row.labour),
        total: money(row.total),
      })),
      totals: {
        month: plural(count(totals?.months ?? null), 'month'),
        operations: count(totals?.operations ?? null),
        vehicles: null,
        parts: money(totals?.parts ?? null),
        labour: money(totals?.labour ?? null),
        total: money(totals?.total ?? null),
      },
      total: count(totals?.months ?? null),
    };
  },
};

// ---------------------------------------------------------------------------
// RPT-04 — driver assignment history
// ---------------------------------------------------------------------------

interface AssignmentRow {
  driver_name: string;
  licence_no: string;
  plate: string;
  make: string;
  model: string;
  start_date: Date;
  end_date: Date | null;
  days: number;
}

const driverAssignments: ReportDefinition = {
  name: 'driver-assignments',
  title: 'Driver assignment history',
  description: 'Every vehicle assignment with its date range, closed and current.',
  supportedFilters: ['from', 'to', 'vehicleId', 'driverId'],

  async run(filter, slice) {
    // `assignments` has no `deleted_at`: DRV-03 keeps history by closing a row
    // rather than removing it, so there is nothing to filter out. The driver may
    // be soft-deleted, and their past assignments still belong in the history.
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];

    // Overlap, not containment: an assignment running across the whole window
    // belongs in a report about that window, even though neither of its
    // endpoints falls inside it. Testing `start_date >= from` would drop
    // precisely the long-running assignments the reader most wants.
    if (filter.from) {
      conditions.push(Prisma.sql`(a.end_date IS NULL OR a.end_date >= ${filter.from}::date)`);
    }
    if (filter.to) conditions.push(Prisma.sql`a.start_date <= ${filter.to}::date`);
    if (filter.driverId) conditions.push(Prisma.sql`a.driver_id = ${filter.driverId}::uuid`);

    const base = Prisma.sql`
      FROM assignments a
      JOIN drivers d  ON d.id = a.driver_id
      JOIN vehicles v ON v.id = a.vehicle_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ${vehicleFilter(filter, Prisma.sql`a.vehicle_id`)}
    `;

    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<AssignmentRow[]>(Prisma.sql`
        SELECT d.first_name || ' ' || d.last_name AS driver_name,
               d.licence_no, v.plate, v.make, v.model,
               a.start_date, a.end_date,
               -- An open assignment is counted to today, which is what "how long
               -- has this driver had this van" means while it is still running.
               (COALESCE(a.end_date, CURRENT_DATE) - a.start_date)::int AS days
        ${base}
        ORDER BY a.start_date DESC
        ${paginate(slice)}
      `),
      prisma.$queryRaw<[{ rows: bigint; drivers: bigint; days: string }]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS rows,
               COUNT(DISTINCT a.driver_id)::bigint AS drivers,
               COALESCE(SUM(COALESCE(a.end_date, CURRENT_DATE) - a.start_date), 0)::text AS days
        ${base}
      `),
    ]);

    const [totals] = summary;

    return {
      columns: [
        { key: 'driver', label: 'Driver', type: 'text' },
        { key: 'licenceNo', label: 'Licence', type: 'text' },
        { key: 'plate', label: 'Vehicle', type: 'text' },
        { key: 'vehicleName', label: 'Make & model', type: 'text' },
        { key: 'startDate', label: 'From', type: 'date' },
        { key: 'endDate', label: 'To', type: 'date' },
        { key: 'days', label: 'Days', type: 'integer' },
      ],
      rows: rows.map((row) => ({
        driver: row.driver_name,
        licenceNo: row.licence_no,
        plate: row.plate,
        vehicleName: `${row.make} ${row.model}`,
        startDate: dateOnly(row.start_date),
        // Null, not "ongoing": the column is typed `date`, and a serialiser must
        // be free to render the gap as a spreadsheet blank rather than text.
        endDate: dateOnly(row.end_date),
        days: row.days,
      })),
      totals: {
        driver: plural(count(totals?.drivers ?? null), 'driver'),
        licenceNo: null,
        plate: null,
        vehicleName: null,
        startDate: null,
        endDate: null,
        days: money(totals?.days ?? null),
      },
      total: count(totals?.rows ?? null),
    };
  },
};

// ---------------------------------------------------------------------------
// RPT-05 — expiring documents
// ---------------------------------------------------------------------------

interface ExpiringRow {
  plate: string;
  vehicle_status: string;
  type_label: string;
  reference_no: string | null;
  issue_date: Date | null;
  expiry_date: Date;
  notice_days: number;
  days_left: number;
  status: string;
}

const expiringDocuments: ReportDefinition = {
  name: 'expiring-documents',
  title: 'Expiring documents',
  description: 'Documents by expiry date, with their status against the notice period.',
  supportedFilters: ['from', 'to', 'vehicleId'],

  async run(filter, slice) {
    // The same DOC-05 expression as the document list and the dashboard.
    const status = Prisma.sql`
      CASE
        WHEN d.expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN d.expiry_date - COALESCE(d.notice_days, dt.default_notice_days) <= CURRENT_DATE
          THEN 'EXPIRING_SOON'
        ELSE 'VALID'
      END
    `;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`d.deleted_at IS NULL`,
      Prisma.sql`v.deleted_at IS NULL`,
    ];
    // Here the range means expiry, which is the only date a reader of this
    // report is asking about.
    if (filter.from) conditions.push(Prisma.sql`d.expiry_date >= ${filter.from}::date`);
    if (filter.to) conditions.push(Prisma.sql`d.expiry_date <= ${filter.to}::date`);

    const base = Prisma.sql`
      FROM documents d
      JOIN document_types dt ON dt.id = d.document_type_id
      JOIN vehicles v ON v.id = d.vehicle_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      ${vehicleFilter(filter, Prisma.sql`d.vehicle_id`)}
    `;

    const [rows, summary] = await Promise.all([
      prisma.$queryRaw<ExpiringRow[]>(Prisma.sql`
        SELECT v.plate, v.status AS vehicle_status, dt.label AS type_label,
               d.reference_no, d.issue_date, d.expiry_date,
               COALESCE(d.notice_days, dt.default_notice_days) AS notice_days,
               (d.expiry_date - CURRENT_DATE)::int AS days_left,
               ${status} AS status
        ${base}
        ORDER BY d.expiry_date ASC
        ${paginate(slice)}
      `),
      prisma.$queryRaw<[{ rows: bigint; expired: bigint; expiring: bigint }]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS rows,
               COUNT(*) FILTER (WHERE ${status} = 'EXPIRED')::bigint AS expired,
               COUNT(*) FILTER (WHERE ${status} = 'EXPIRING_SOON')::bigint AS expiring
        ${base}
      `),
    ]);

    const [totals] = summary;

    return {
      columns: [
        { key: 'plate', label: 'Vehicle', type: 'text' },
        { key: 'vehicleStatus', label: 'Vehicle status', type: 'text' },
        { key: 'typeLabel', label: 'Document', type: 'text' },
        { key: 'referenceNo', label: 'Reference', type: 'text' },
        { key: 'issueDate', label: 'Issued', type: 'date' },
        { key: 'expiryDate', label: 'Expires', type: 'date' },
        { key: 'noticeDays', label: 'Notice (days)', type: 'integer' },
        { key: 'daysLeft', label: 'Days left', type: 'integer' },
        { key: 'status', label: 'Status', type: 'text' },
      ],
      rows: rows.map((row) => ({
        plate: row.plate,
        vehicleStatus: row.vehicle_status,
        typeLabel: row.type_label,
        referenceNo: row.reference_no,
        issueDate: dateOnly(row.issue_date),
        expiryDate: dateOnly(row.expiry_date),
        noticeDays: row.notice_days,
        daysLeft: row.days_left,
        status: row.status,
      })),
      totals: {
        plate: plural(count(totals?.rows ?? null), 'document'),
        vehicleStatus: null,
        typeLabel: null,
        referenceNo: null,
        issueDate: null,
        expiryDate: null,
        noticeDays: null,
        daysLeft: null,
        status: `${count(totals?.expired ?? null)} expired, ${count(totals?.expiring ?? null)} expiring`,
      },
      total: count(totals?.rows ?? null),
    };
  },
};

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const REPORTS: Readonly<Record<ReportName, ReportDefinition>> = {
  'maintenance-history': maintenanceHistory,
  'cost-by-vehicle': costByVehicle,
  'cost-by-period': costByPeriod,
  'driver-assignments': driverAssignments,
  'expiring-documents': expiringDocuments,
};
