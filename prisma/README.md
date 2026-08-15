# Database — working notes

## Commands

```bash
npm run db:up        # start Postgres + Redis (docker/compose.dev.yml)
npm run db:migrate   # create/apply migrations in development
npm run db:seed      # idempotent reference + demo data
npm run db:reset     # destroy volumes and start clean
npm run db:studio    # browse the data
```

## Constraints Prisma cannot express

Prisma's schema language has no syntax for **partial indexes** or **CHECK
constraints**. Both are required here, so `migrations/*/migration.sql` is
hand-extended below the generated section. The most important is:

```sql
CREATE UNIQUE INDEX "assignments_one_open_per_vehicle"
  ON "assignments" ("vehicle_id")
  WHERE "end_date" IS NULL;
```

That single index is decision Q5 — one driver per vehicle — enforced by the
database. A service-layer check would be equivalent only until the first
endpoint forgets it.

### Does `prisma migrate dev` drop them?

**No — verified.** After applying the initial migration, re-running
`prisma migrate dev` reports _"Already in sync, no schema change or pending
migration was found"_ and leaves the hand-written index and CHECKs in place.
Prisma diffs `schema.prisma` against the shadow database built from the
migration history; because the custom SQL is _part of that history_, it is
present in both sides of the comparison, and constructs Prisma cannot model are
not proposed for removal.

**Still review generated SQL before applying it.** This was verified for the
constructs currently in use, not proven for every future case. When a migration
touches `assignments`, `maintenance_plans`, `maintenance_ops`, `documents` or
`attachments`, read the generated file and confirm nothing drops a constraint
listed below.

### Inventory of hand-written constraints

| Object                                        | Table             | Guarantees                                                                |
| --------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `assignments_one_open_per_vehicle`            | assignments       | **Q5**: at most one open assignment per vehicle                           |
| `assignments_dates_ordered`                   | assignments       | an assignment cannot end before it starts                                 |
| `maintenance_plans_exactly_one_target`        | maintenance_plans | a plan targets one vehicle **or** one vehicle type                        |
| `maintenance_plans_interval_matches_trigger`  | maintenance_plans | a DATE plan has `interval_days`, MILEAGE has `interval_km`, BOTH has both |
| `maintenance_plans_intervals_positive`        | maintenance_plans | intervals are positive                                                    |
| `maintenance_ops_cost_total_consistent`       | maintenance_ops   | `cost_total = cost_parts + cost_labour`                                   |
| `maintenance_ops_costs_non_negative`          | maintenance_ops   | no negative costs                                                         |
| `maintenance_ops_scheduled_has_trigger`       | maintenance_ops   | a SCHEDULED job is due by a date or a mileage                             |
| `mileage_readings_non_negative`               | mileage_readings  | odometer readings are not negative                                        |
| `vehicles_mileage_non_negative`               | vehicles          | same for the denormalised current value                                   |
| `documents_notice_days_positive`              | documents         | a notice period of 0 is not a reminder                                    |
| `document_types_default_notice_days_positive` | document_types    | as above                                                                  |
| `attachments_size_positive`                   | attachments       | a zero-byte object is a failed upload                                     |

### Partial indexes (FF-1204)

Prisma cannot express a `WHERE` clause on an index, so these are hand-written
too. Both were chosen from `EXPLAIN (ANALYZE)` against the reference dataset
(`npx tsx prisma/seed-reference.ts` — 250 vehicles, 4 000 operations) and kept
only because the planner actually chose them and the query got faster. An index
the planner ignores is pure write cost.

| Index                             | Serves                                     | Measured       |
| --------------------------------- | ------------------------------------------ | -------------- |
| `maintenance_ops_cost_basis`      | DSH-08, RPT-02, RPT-03 — `COST_BASIS_SQL`  | 5.96 → 3.95 ms |
| `maintenance_ops_open_by_vehicle` | DSH-04, DSH-05, `?due=` — `due-buckets.ts` | 3.37 → 0.84 ms |

Each index's predicate is a copy of the query's predicate. If either definition
in the code changes, the index silently stops being used — no error, just a
slower query — so the two must be edited together.

## Design decisions worth knowing

**Soft delete (Q6).** Every business table has `deleted_at`. Reference tables
(`vehicle_types`, `document_types`) use `is_active` instead — they are lookups,
not records. Three tables are deliberately append-only and have neither:
`mileage_readings` (a wrong reading is corrected by a new one, so the history
that triggered a task stays reconstructable), `assignments` (reassignment closes
a row, never overwrites it — DRV-03), and `audit_log`.

**`document.status` is not a column.** DOC-05's valid / expiring soon / expired
is derived in SQL from `expiry_date` and the effective notice period. A stored
status is wrong the moment the clock passes midnight with no write to the row.

**The damage ↔ maintenance link has one column, not two.** The plan sketched
both `maintenance_ops.damage_id` and `damages.maintenance_op_id`. Two columns
can disagree. Only `maintenance_ops.damage_id` exists (unique); Prisma's reverse
relation gives `damage.maintenanceOp`, satisfying DMG-02's "visible from both
sides" without a second source of truth.

**`vehicles.current_mileage` is denormalised** from the newest
`mileage_readings` row so list filtering stays fast. `mileage_readings` is
authoritative; the service layer maintains the copy.

**Attachments are polymorphic** (`entity_type` + `entity_id`, no FK) so one
upload pipeline serves documents, invoices and damage photos. The service layer
validates that the target exists before issuing a signed URL — the database
cannot do it here.

## Soft delete at runtime (FF-105)

`apps/api/src/platform/db.ts` exports two clients:

| Export          | Behaviour                                            | Use                                    |
| --------------- | ---------------------------------------------------- | -------------------------------------- |
| `prisma`        | reads exclude `deleted_at IS NOT NULL` automatically | everything                             |
| `withDeleted()` | unfiltered                                           | historical reports, audit, admin purge |

The filtered client injects `deletedAt: null` into `where` for `findUnique`,
`findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`, `count`,
`aggregate` and `groupBy`, **and into nested list relations** reached through
`include` / `select`, at any depth. The soft-deletable model set is read from
Prisma's DMMF at runtime, so a model added later with a `deleted_at` column is
covered automatically.

Two escape hatches, both visible in review:

```ts
withDeleted().vehicle.findMany({ … })                     // everything
prisma.vehicle.findMany({ where: { deletedAt: { not: null } } })  // only deleted
```

Naming `deletedAt` anywhere in the `where` — including inside `AND` / `OR` /
`NOT` — suppresses the automatic filter for that query.

### Two limitations to know

**To-one relations cannot be filtered.** Prisma accepts a nested `where` only on
list relations, so `document.findMany({ include: { vehicle: true } })` still
resolves a soft-deleted vehicle. A service following a to-one link into a
possibly deleted record must check `deletedAt` itself.

**Writes are not intercepted.** `delete` still hard-deletes. Soft deletion is an
explicit `update({ data: { deletedAt: new Date() } })` performed by the service
layer. Silently rewriting a `delete` into an update would make a destructive
call look harmless in code review, which is worse than requiring the explicit
form.

## Known limitation: unique keys and soft delete

`users.email`, `vehicles.plate` and `vehicles.vin` are **globally** unique,
including across soft-deleted rows. Consequence: a plate belonging to a
soft-deleted vehicle cannot be reused until an administrator purges the row.

This was chosen over a partial unique index (`WHERE deleted_at IS NULL`) because
Prisma's `findUnique` requires a true unique constraint, and login is a hot,
security-sensitive path that benefits from it. If plate reuse turns out to
matter operationally — plates are transferable in some jurisdictions — the fix
is a partial index on `vehicles` plus `findFirst` at the two call sites.
