/**
 * What counts as maintenance spend — MNT-05, DSH-08, RPT-02, RPT-03.
 *
 * RPT-06's acceptance criterion is that **exported figures reconcile with the
 * dashboard cost summary for the same period**. That is a promise about two
 * pieces of code agreeing, and the only way to keep it is to have one piece of
 * code. The predicate below is imported by the dashboard's monthly chart and by
 * both cost reports; there is nowhere else that decides what a cost is.
 *
 * Three decisions are baked in, each of which is a plausible place for two
 * implementations to differ:
 *
 * - **Only COMPLETED work counts.** A planned job has an estimate, not a cost.
 * - **Attributed to `completed_at`, not `due_date`.** Cost is incurred when the
 *   work is done; a job due in January and finished in March belongs to March,
 *   which is where its invoice lands too.
 * - **Archived and soft-deleted *vehicles* still count.** A van sold in March
 *   does not un-spend February's servicing. Excluding them would make historical
 *   totals change value over time, which makes reconciliation impossible by
 *   definition — the exported March figure would stop matching the March figure
 *   a month later. Only a soft-deleted *operation* is excluded, because deleting
 *   the record is the act of saying it should never have existed.
 */

import { Prisma } from '@prisma/client';

/**
 * The rows that constitute spend.
 *
 * Written against the alias `m`, so every caller aliases `maintenance_ops` as
 * `m`. Raw SQL bypasses the soft-delete extension, so `deleted_at IS NULL` is
 * part of the predicate rather than something a caller must remember.
 */
export const COST_BASIS_SQL: Prisma.Sql = Prisma.sql`
  m.deleted_at IS NULL
  AND m.status = 'COMPLETED'
  AND m.completed_at IS NOT NULL
`;

/** Restricts the basis to a date range, inclusive at both ends. */
export function costPeriodSql(from?: string, to?: string): Prisma.Sql {
  const clauses: Prisma.Sql[] = [COST_BASIS_SQL];
  if (from) clauses.push(Prisma.sql`m.completed_at >= ${from}::date`);
  // `< to + 1 day` rather than `<= to`: `completed_at` is a timestamp, and
  // `<= '2026-08-14'` silently excludes everything completed during that day.
  if (to) clauses.push(Prisma.sql`m.completed_at < (${to}::date + INTERVAL '1 day')`);
  return Prisma.join(clauses, ' AND ');
}
