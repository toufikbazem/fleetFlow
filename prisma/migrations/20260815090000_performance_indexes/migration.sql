-- Performance indexes — FF-1204 (DSH acceptance: the full view under 2 seconds).
--
-- Both were chosen from `EXPLAIN (ANALYZE)` against the reference dataset
-- (250 vehicles / 4 000 maintenance operations, `prisma/seed-reference.ts`),
-- not from guessing at what looked slow. Each was measured before and after,
-- and each is here because the planner actually chose it and the query got
-- faster. Indexes the planner ignores are pure write cost, so the ones that did
-- not earn their place were left out.
--
-- Both are PARTIAL. That is the point of them:
--
--   * The rows they cover are a minority of the table and are the only rows
--     these queries ever look at — completed work for costs, open work for the
--     dashboard buckets. A full index would be several times larger and would
--     still have to discard most of what it read.
--   * They match the query predicates exactly, which is what lets Postgres use
--     them at all rather than falling back to a sequential scan.
--
-- Measured, worst of three runs each:
--
--   monthly cost (DSH-08, RPT-02, RPT-03)   5.96 ms -> 3.95 ms
--   open maintenance (DSH-04, DSH-05)       3.37 ms -> 0.84 ms
--
-- The absolute numbers are already far inside the 2 000 ms budget; the reason
-- to add them is the slope, not the intercept. Both queries scan the whole
-- table today, so their cost grows with every operation ever recorded — and a
-- fleet's maintenance history only ever grows.

-- DSH-08, RPT-02, RPT-03 — what counts as spend (see `reports/cost-basis.ts`).
-- The predicate is copied from COST_BASIS_SQL; if that definition changes, this
-- index silently stops being used, which is why they are documented together.
CREATE INDEX IF NOT EXISTS "maintenance_ops_cost_basis"
  ON "maintenance_ops" ("completed_at")
  WHERE "status" = 'COMPLETED'
    AND "deleted_at" IS NULL
    AND "completed_at" IS NOT NULL;

-- DSH-04, DSH-05 and the `?due=` list filter — the open-work bucket
-- (see `maintenance/due-buckets.ts`). Keyed by vehicle_id because every caller
-- joins to vehicles immediately afterwards.
CREATE INDEX IF NOT EXISTS "maintenance_ops_open_by_vehicle"
  ON "maintenance_ops" ("vehicle_id")
  WHERE "status" <> 'COMPLETED'
    AND "deleted_at" IS NULL;
