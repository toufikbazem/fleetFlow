-- Guards for the maintenance trigger engine (FF-503).
--
-- The engine's contract is that running it twice does nothing the second time.
-- That could be a check in the service — "is there already an open job for this
-- plan and vehicle?" — but a check is a race: two concurrent runs, or a retry
-- after a timeout, both read "no" and both insert.
--
-- The same reasoning as Q5's one-open-assignment index and NTF-07's dedupe key:
-- if the guarantee matters, the database holds it.

-- At most one *open* operation per (plan, vehicle).
--
-- Scoped to plan-generated work: unexpected jobs have no plan_id and are
-- deliberately unconstrained — a vehicle can have several unrelated repairs
-- open at once. Completed work is excluded so the same plan can generate the
-- next service after this one is finished, which is the whole point of a
-- recurring plan.
CREATE UNIQUE INDEX "maintenance_ops_one_open_per_plan_vehicle"
  ON "maintenance_ops" ("plan_id", "vehicle_id")
  WHERE "plan_id" IS NOT NULL
    AND "status" <> 'COMPLETED'
    AND "deleted_at" IS NULL;

-- A completed job must record when it was completed, and an incomplete one must
-- not claim to have been. Without this, "completed_at IS NOT NULL" and
-- "status = 'COMPLETED'" can disagree, and the cost report reads one while the
-- board reads the other.
ALTER TABLE "maintenance_ops"
  ADD CONSTRAINT "maintenance_ops_completed_has_timestamp"
  CHECK (
    ("status" =  'COMPLETED' AND "completed_at" IS NOT NULL)
    OR
    ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
  );

-- Work cannot be completed before it was started.
ALTER TABLE "maintenance_ops"
  ADD CONSTRAINT "maintenance_ops_started_before_completed"
  CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at");
