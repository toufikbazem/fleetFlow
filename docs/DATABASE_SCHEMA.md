# FleetFlow — Database schema

**Deliverable:** PRD §7, "Database schema" · **Version:** 1.0 · **Date:** 15 August 2026
**Engine:** PostgreSQL 16 · **Source of truth:** [`prisma/schema.prisma`](../prisma/schema.prisma)

---

## 1. How to read this document

This describes **why** the schema looks as it does. The authoritative structure
is `prisma/schema.prisma` and the SQL in `prisma/migrations/`, which are
generated and applied together; this explains the decisions behind them so a
future developer can change things without undoing something deliberate.

Working notes on constraints, drift and the soft-delete runtime live in
[`prisma/README.md`](../prisma/README.md). This document is the client-facing
overview.

**17 tables, 15 enumerated types.** Every business table carries `created_at`,
`updated_at` and — with three deliberate exceptions — `deleted_at`.

---

## 2. The five decisions that shape everything else

### 2.1 Soft delete everywhere (client decision Q6)

`deleted_at` on every business table. Nothing is ever removed by an ordinary
delete; the row is stamped and hidden.

**Why it matters:** USR-01's acceptance criterion is that deleting a user leaves
their maintenance and damage records _intact and attributed_. That is only
possible if the user row survives. The same reasoning applies to vehicles: a
report about last year's costs must still be able to name the van.

**How it is enforced:** a Prisma query extension appends `deleted_at IS NULL` to
every read automatically, and the set of soft-deletable models is read from the
schema at runtime — so a table added later is covered the moment it exists. Seeing
deleted rows requires saying so explicitly, which is visible in review.

**Three tables have no `deleted_at`, on purpose:**

| Table              | Why                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `mileage_readings` | A wrong reading is corrected by recording a new one. The history that triggered a maintenance task must stay reconstructable. |
| `assignments`      | Reassignment _closes_ a row rather than overwriting it (DRV-03). There is nothing to delete.                                  |
| `audit_log`        | An audit trail that can be edited is not an audit trail.                                                                      |

Two lookup tables — `vehicle_types` and `document_types` — use `is_active`
instead. They are reference data, not records.

### 2.2 Document status is computed, never stored

`documents` has **no status column.** DOC-05's valid / expiring soon / expired is
derived in SQL from `expiry_date` and the effective notice period.

**Why:** a stored status is wrong the moment the clock passes midnight with no
write to the row. A document would sit in the database saying "valid" on the
morning it expired, and the only thing that could fix it is a job nobody
noticed had stopped. Deriving it means the value cannot be stale.

The same expression is used by the document list, the dashboard and the
expiring-documents report, so those three can never disagree.

### 2.3 Mileage is a table, not a column

`mileage_readings` holds the history; `vehicles.current_mileage` is a
denormalised copy of the newest reading, maintained by the service layer so list
filtering stays fast.

**Why:** VEH-05 makes mileage a maintenance trigger. A single mutable column
cannot answer "what was the odometer when this became due", and cannot survive
correcting a typo without destroying the trigger history.

### 2.4 The damage ↔ maintenance link has one column, not two

Only `maintenance_ops.damage_id` exists, and it is unique. Prisma's reverse
relation gives `damage.maintenanceOp`.

**Why:** DMG-02 requires the link to be visible from both sides. Two columns can
disagree; one column with a relation cannot.

### 2.5 Money is `DECIMAL(12,2)`, never a float

`cost_parts`, `cost_labour`, `cost_total` are decimals, and `cost_total` is
pinned to `cost_parts + cost_labour` by a database CHECK.

**Why:** binary floating point cannot represent 0.10 exactly, and RPT-06 requires
exported figures to reconcile with the dashboard to the penny. The CHECK means a
stored total can never drift from its components — an exported figure and the
dashboard cannot disagree because one of them added the parts and the other read
a stale total.

---

## 3. The tables

### 3.1 Identity and access

| Table             | Purpose                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`           | Login accounts. `role` is one of five (PRD §2). `is_active` deactivates without deleting (USR-03).                                                                                                                                         |
| `password_resets` | Single-use, time-limited reset tokens. The **hash** is stored, never the token — whoever can read this table must not thereby be able to reset everybody's password.                                                                       |
| `audit_log`       | Who did what, append-only. Not in the PRD; cheap to add now and impossible to retrofit for past events.                                                                                                                                    |
| `settings`        | Runtime configuration as JSON, one row per branch (`general`, `notifications`, `uploads`). Notice periods and the daily send time are the values most likely to be tuned after go-live, and tuning them must never require a redeployment. |

### 3.2 Fleet

| Table              | Purpose                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `vehicle_types`    | Reference list (van, truck, car). Maintenance plans can target a type rather than a vehicle.                       |
| `vehicles`         | The fleet. `status` follows the VEH-06 lifecycle: active · under maintenance · archived.                           |
| `mileage_readings` | Odometer history, append-only.                                                                                     |
| `drivers`          | People who drive. `user_id` is **optional** — DRV-04 makes the login account optional, and most drivers have none. |
| `assignments`      | Which driver holds which vehicle, and when. `end_date IS NULL` means the assignment is open.                       |

**The single most important index in the database:**

```sql
CREATE UNIQUE INDEX assignments_one_open_per_vehicle
  ON assignments (vehicle_id) WHERE end_date IS NULL;
```

That is client decision Q5 — one driver per vehicle — enforced by Postgres. The
service layer could check before inserting, and two simultaneous requests would
both read "none", both pass, and both insert. A constraint cannot be raced.

### 3.3 Maintenance

| Table               | Purpose                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maintenance_plans` | A rule: "every 15 000 km, service this vehicle type." Targets exactly one vehicle **or** one vehicle type (CHECK), and its interval must match its trigger (CHECK). |
| `maintenance_ops`   | A job. Everything a mechanic works on and everything a cost report counts.                                                                                          |

A plan with a trigger but no interval would never fire — and would fail
_silently_, which is why the database refuses it rather than trusting the form.

### 3.4 Documents and files

| Table            | Purpose                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document_types` | Configurable reference list with a default notice period (DOC-06).                                                                                                                                                                                                                                                    |
| `documents`      | Paperwork attached to a vehicle, with an expiry and an optional per-document notice override.                                                                                                                                                                                                                         |
| `attachments`    | Polymorphic (`entity_type` + `entity_id`, no foreign key) so **one** upload pipeline serves document scans, maintenance invoices and damage photos. `upload_state` is `PENDING` until the stored object's real size and content type have been verified — the client's claim about what it uploaded is never trusted. |

### 3.5 Damages and notifications

| Table                     | Purpose                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `damages`                 | Driver-reported problems and their triage state.                                    |
| `notifications`           | In-app reminders.                                                                   |
| `notification_deliveries` | The email log: status, attempts, SMTP message id and response, rejected recipients. |

**The second most important index:**

```sql
UNIQUE (user_id, rule, entity_type, entity_id, fire_date)
```

That is NTF-07 — one notification per rule, per entity, per day — enforced by the
database. It is what makes the reminder job safe to run twice, which matters
because during acceptance testing somebody _will_ press the button four times.

`notification_deliveries` doubles as the send queue. One source of truth is
better than a queue and a log that can disagree after a crash.

---

## 4. Constraints Prisma cannot express

Prisma's schema language has no syntax for partial indexes or CHECK constraints,
so the migration SQL is hand-extended. There are **two partial unique indexes,
two partial performance indexes and thirteen CHECK constraints.** The full
inventory, with what each guarantees, is in
[`prisma/README.md`](../prisma/README.md).

The principle behind all of them: **a rule that lives only in application code is
a rule that one code path will eventually forget.** Every invariant that would be
expensive to discover broken — one open assignment, costs that add up, a
scheduled job that is actually due by something — is held by the database.

---

## 5. Migrations

```bash
npm run db:migrate    # create and apply in development
npm run db:deploy     # apply in a deployed environment
npm run db:seed       # idempotent demo data
```

There are four migrations. Hand-written SQL is part of the migration history, so
Prisma does not propose dropping it — verified, and explained in
`prisma/README.md`.

**Before applying a generated migration that touches `assignments`,
`maintenance_plans`, `maintenance_ops`, `documents` or `attachments`, read the
SQL** and confirm nothing drops a constraint from the inventory.

---

## 6. Reference dataset

`prisma/seed-reference.ts` builds the volume dataset used for performance work
(§7/Q2: 250 vehicles, 40 users, 4 000 maintenance operations, 1 500 documents).
It layers on top of the demo seed and is removable with `--clean`.
