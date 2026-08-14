/**
 * "Overdue" and "upcoming", defined once — MNT-06, DSH-04, DSH-05.
 *
 * These two words appear in three places: the dashboard counters, the
 * maintenance list a counter drills through to, and the notification rules that
 * email people about the same jobs. Three implementations would be three
 * chances to disagree, and the disagreement is invisible until somebody notices
 * the dashboard says 7 and the list it opens shows 5.
 *
 * **Overdue is computed, not read from `status`.** The trigger engine's sweep
 * (FF-503) writes OVERDUE once a day. Between sweeps, a job whose due date
 * passed at midnight still says PLANNED — so reading the stored status makes the
 * answer depend on when the worker last ran. The stored status is still
 * honoured, so anything the engine marked stays marked; this only adds the jobs
 * it has not reached yet.
 *
 * The mileage half is why this is SQL rather than a Prisma filter: it compares
 * `maintenance_ops.due_mileage` against `vehicles.current_mileage`, a column in
 * another table, which the query builder cannot express.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';

export type DueBucket = 'OVERDUE' | 'UPCOMING' | 'LATER';

/**
 * The bucket expression.
 *
 * Takes the notice thresholds as parameters rather than reading settings itself,
 * so a caller can only get an answer by stating which window it asked about —
 * and so the dashboard and the notification rules can be shown to be using the
 * same numbers.
 */
export function maintenanceBucketSql(noticeDays: number, noticeKm: number): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN m.status = 'OVERDUE'
        OR (m.due_date IS NOT NULL AND m.due_date < CURRENT_DATE)
        OR (m.due_mileage IS NOT NULL AND v.current_mileage >= m.due_mileage)
        THEN 'OVERDUE'
      WHEN (m.due_date IS NOT NULL AND m.due_date <= CURRENT_DATE + ${noticeDays}::int)
        OR (m.due_mileage IS NOT NULL AND v.current_mileage + ${noticeKm}::int >= m.due_mileage)
        THEN 'UPCOMING'
      ELSE 'LATER'
    END
  `;
}

/**
 * The `FROM`/`WHERE` every bucket query shares.
 *
 * Raw SQL bypasses the soft-delete extension, so `deleted_at IS NULL` is stated
 * here explicitly — for the vehicle as well as the operation, because a job on a
 * deleted vehicle must not surface either.
 *
 * COMPLETED work is excluded: finished work is neither upcoming nor overdue.
 */
export function bucketBaseSql(scopeClause: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM maintenance_ops m
    JOIN vehicles v ON v.id = m.vehicle_id
    WHERE m.deleted_at IS NULL
      AND v.deleted_at IS NULL
      AND m.status <> 'COMPLETED'
      AND ${scopeClause}
  `;
}

/**
 * The ids of every operation in one bucket.
 *
 * Used by the maintenance list to serve `?due=overdue`, so the drill-through
 * from a dashboard counter lands on exactly the rows that were counted. Ids
 * rather than a `where` fragment because the mileage comparison cannot be
 * expressed in Prisma at all; feeding the full id set back in keeps pagination
 * and totals correct, which filtering a fetched page in memory would not.
 *
 * The set is bounded by open maintenance operations — thousands at most on the
 * reference fleet, not a table scan of history.
 */
export async function bucketedOpIds(
  bucket: Exclude<DueBucket, 'LATER'>,
  scopeClause: Prisma.Sql,
  noticeDays: number,
  noticeKm: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM (
      SELECT m.id, ${maintenanceBucketSql(noticeDays, noticeKm)} AS bucket
      ${bucketBaseSql(scopeClause)}
    ) bucketed
    WHERE bucket = ${bucket}
  `);
  return rows.map((row) => row.id);
}
