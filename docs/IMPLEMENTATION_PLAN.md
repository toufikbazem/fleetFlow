# FleetFlow MVP — Implementation Plan

**Source:** [FleetFlow — Product Requirements Document (MVP)](https://app.notion.com/p/3b438a183f8e80ae96cefa478ed57127), PRD v0.1.
**Plan version:** 2.0 · **Updated:** 7 August 2026
**Companion document:** [TASKS.md](TASKS.md) — the executable task breakdown.

> **Scope of this plan (client direction, 7 Aug 2026)**
>
> - **Hosting, deployment, environment provisioning and backup policy are out of scope** and are not planned here. The application is built to be deployment-agnostic: all infrastructure bindings are environment variables, and nothing in the codebase assumes a particular host.
> - **The commercial proposal's timeline and phase dates are disregarded.** Sequencing below is by dependency, not by calendar date. Estimates are given in person-days so they can be mapped onto whatever schedule is agreed separately.
> - **Email is sent via Nodemailer over SMTP**, replacing Resend from the PRD.
> - **Testing is deferred (client decision, 8 Aug 2026).** Remaining build tasks
>   are code only; all tests are written in E12. See §5 and TASKS.md for the
>   consequences — the total effort barely moves, but a quarter of the remaining
>   work now sits in one late block with an unestimated remediation task behind it.

---

## 0. Executive read on the PRD

The PRD is well-formed and buildable. Two things drive every decision below:

1. **Ten modules is a real scope.** Bottom-up estimate: **≈64 person-days plus FF-1208**, of which ~45 is build, ~16 testing and hardening, ~3 documentation and handover. §6 sequences this by dependency. (Before the 8 Aug testing decision the split was ~56 build / ~6 QA for the same ≈65 total — the work moved, it did not shrink.)
2. **The schema-critical open questions are now closed** (§7). One driver per vehicle, soft delete everywhere, English only. These were the decisions that could not be made cheaply after the first migration, and they are settled before a line of schema is written — which is the right order.

The design goal throughout: P0 requirements land first, and P1 items sit on clean seams that can be dropped without rework.

---

## 1. Architecture

### 1.1 Shape

A **modular monolith** — one Express API, one React SPA, one Postgres database, one Redis, one worker process. Not microservices: this is a single-company deployment, and service boundaries would cost more than they buy.

```
┌──────────────┐   HTTPS/JSON   ┌────────────────────────────┐
│  React SPA   │───────────────►│  api      (Express, Node 22)│
└──────────────┘                └──────────┬─────────────────┘
                                           │
                                ┌──────────┴─────────────────┐
                                │  worker  (BullMQ: daily    │
                                │  notification job + email  │
                                │  send/retry queue)         │
                                └──────────┬─────────────────┘
                                           │
        ┌──────────────┬──────────────┬────┴─────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
   PostgreSQL       Redis      Supabase Storage    SMTP        (filesystem
   (primary data) (cache,      (private buckets,  (Nodemailer)   temp: export
                   queue,       signed URLs)                     generation)
                   sessions)
```

The **worker** is a second process from the same image with a different entrypoint. It owns the daily notification job and the email queue. Keeping it out of the API process means a slow SMTP handshake or a long retry loop can never stall a user request.

All external bindings — `DATABASE_URL`, `REDIS_URL`, `SUPABASE_*`, `SMTP_*` — are environment variables validated at boot. Nothing in the code knows or cares where it runs.

### 1.2 Repository layout

npm workspaces monorepo. One `package.json` at root, one lockfile, one CI pipeline.

```
fleetflow/
├── apps/
│   ├── api/          Express + TypeScript. Layered: routes → services → repositories.
│   │   └── src/
│   │       ├── modules/{auth,users,drivers,vehicles,maintenance,
│   │       │            documents,damages,notifications,dashboard,reports}/
│   │       │            └── {routes,service,repository,schema}.ts
│   │       ├── platform/  db, redis, storage, mailer, logger, errors, middleware
│   │       └── worker/    cron entrypoint, rule engine, email queue
│   └── web/          Vite + React + TypeScript SPA
│       └── src/
│           ├── features/<same module names>/
│           ├── components/ui/     shadcn/ui primitives
│           ├── components/        DataTable, FileUpload, StatusBadge, …
│           └── lib/               api client, auth, query keys, formatters
├── packages/
│   └── shared/       Zod schemas, inferred TS types, the permission matrix,
│                     status enums, notification rule ids. Imported by BOTH apps.
├── prisma/           schema.prisma, migrations, seed
└── docs/             this plan, TASKS.md, ADRs, generated OpenAPI
```

**`packages/shared` is the most important structural decision.** Every request/response body is a Zod schema defined once there. The API validates with it; the web app infers its TypeScript types from it and reuses it for form validation. This is what makes ten modules survivable with several developers working in parallel — the contract cannot drift, and a breaking change fails `tsc` on both sides immediately.

### 1.3 Stack, with the choices the PRD left open

| Layer    | PRD says                   | This plan uses                                                                                      | Why                                                                                                                                                      |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | React, Tailwind, shadcn/ui | React 19 + Vite + TypeScript, React Router 7, **TanStack Query v5**, react-hook-form + Zod resolver | TanStack Query removes hand-written cache/loading/refetch code across ten CRUD modules                                                                   |
| Backend  | Node.js, Express           | Node 22 LTS, **Express 5**, TypeScript, `pino` logging                                              | Express 5 propagates async errors natively; no wrapper needed                                                                                            |
| ORM      | _(not specified)_          | **Prisma**                                                                                          | Type-safe client from one schema file, honest migrations, fastest path for a team touching 16 tables in parallel                                         |
| Database | PostgreSQL                 | PostgreSQL 16 (Supabase Postgres)                                                                   | Per PRD                                                                                                                                                  |
| Cache    | Redis                      | Redis 7 via `ioredis`                                                                               | Dashboard aggregates, refresh-token revocation, rate limiting, BullMQ backing store                                                                      |
| Files    | Supabase Storage           | Supabase Storage, **private buckets + signed URLs only**                                            | Vehicle documents and damage photos are not public data                                                                                                  |
| Email    | ~~Resend~~                 | **Nodemailer over SMTP**, pooled transport; HTML rendered from React Email components               | Client direction. React Email is just a renderer — it produces an HTML string for any transport, so templates stay portable if the SMTP provider changes |
| Jobs     | "scheduled job" (NTF-05)   | **BullMQ** on the existing Redis                                                                    | `node-cron` alone gives no retries and no visibility; NTF acceptance requires logged, retried email delivery                                             |
| Exports  | Excel, PDF, CSV (RPT-06)   | `exceljs`, **`pdfmake`**, native CSV writer                                                         | `pdfmake` avoids shipping headless Chrome                                                                                                                |
| Tests    | _(not specified)_          | Vitest + Supertest (API), Playwright (E2E)                                                          |                                                                                                                                                          |

### 1.4 Authentication and authorisation

**Token model** (AUTH-01, AUTH-04, AUTH-06):

- **Access token** — JWT, 15 min, `{ sub, role, driverId?, jti }`, sent as `Authorization: Bearer`.
- **Refresh token** — opaque random 256-bit value, 7 days, **httpOnly + Secure + SameSite=Lax cookie**, rotated on every use, stored in Redis as `refresh:{jti} → userId` with TTL.
- **Logout** deletes the refresh key and adds the access token's `jti` to a denylist for its remaining TTL. This is what makes AUTH-04 ("logout invalidating the active session") actually true rather than cosmetic.
- **Role changes take effect on the next request** (USR acceptance) because the access token lives ≤15 min and the refresh path re-reads the user row.

**Authorisation** is the piece most likely to be built wrong under time pressure, so it gets one central implementation:

```ts
// packages/shared/src/permissions.ts — the PRD §2.1 matrix, as data
export const MATRIX = {
  vehicles: { ADMIN: 'F', FLEET_MANAGER: 'F', MECHANIC: 'R', ACCOUNTANT: 'R', DRIVER: 'R_OWN' },
  drivers: { ADMIN: 'F', FLEET_MANAGER: 'F', MECHANIC: '-', ACCOUNTANT: 'R', DRIVER: 'R_SELF' },
  maintenance: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: 'W_ASSIGNED',
    ACCOUNTANT: 'R',
    DRIVER: 'R_OWN',
  },
  documents: { ADMIN: 'F', FLEET_MANAGER: 'F', MECHANIC: 'R', ACCOUNTANT: 'R', DRIVER: 'R_OWN' },
  damages: { ADMIN: 'F', FLEET_MANAGER: 'F', MECHANIC: 'R', ACCOUNTANT: 'R', DRIVER: 'W_REPORT' },
  reports: { ADMIN: 'F', FLEET_MANAGER: 'R', MECHANIC: '-', ACCOUNTANT: 'R', DRIVER: '-' },
  users: { ADMIN: 'F', FLEET_MANAGER: '-', MECHANIC: '-', ACCOUNTANT: '-', DRIVER: '-' },
} as const;
```

Two enforcement layers, both server-side:

1. `authorize('maintenance', 'update')` — middleware, rejects on the matrix before the handler runs.
2. **Scope resolvers** — for the `_OWN` / `_SELF` / `_ASSIGNED` cells, every repository query for a scoped role receives a mandatory `where` fragment (`vehicleId = driver's current assignment`, `mechanicId = user.id`). Scoping lives in the repository, not the route, so a new endpoint cannot forget it.

The same `MATRIX` drives the React app's navigation and button visibility — one source of truth, so the UI can never offer an action the API will refuse. **The UI never decides access; it only mirrors it.**

FF-206 tests this as a generated matrix: 7 modules × 5 roles × 4 verbs, asserting the exact status code. 140 assertions from one table, and the cheapest insurance in the project.

### 1.5 File uploads (DOC-02, MNT-03, DMG-04)

Files never pass through the API process. The client asks the API for a **signed upload URL** (the API validates declared mime type against an allowlist and declared size against a cap, then creates a pending `attachments` row); the browser PUTs directly to Supabase Storage; the client confirms, and the API marks the row `ready` after a HEAD check of the real object size and content type. Downloads are short-lived signed URLs issued per request, after the authorisation check.

This keeps a 20 MB scan off the Node event loop, and — because the bucket is private — a leaked URL expires rather than exposing the fleet's insurance documents indefinitely.

### 1.6 Notification engine (NTF-01 … NTF-07)

One BullMQ repeatable job fires daily at the configured local time and evaluates four rules:

| Rule                   | Condition                                                                     | Recipients (§7, Q4)                                |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `MAINTENANCE_UPCOMING` | op due within notice window by date **or** projected mileage                  | Fleet manager, assigned mechanic, vehicle's driver |
| `DOCUMENT_EXPIRING`    | `expiry_date - notice_days <= today`                                          | Admin, fleet manager                               |
| `INSPECTION_DUE`       | document of type `technical_inspection` inside window                         | Admin, fleet manager, driver                       |
| `MAINTENANCE_OVERDUE`  | `status != completed AND (due_date < today OR current_mileage > due_mileage)` | Admin, fleet manager, assigned mechanic            |

**De-duplication (NTF-07) is a database constraint, not application logic:**

```sql
UNIQUE (user_id, rule, entity_type, entity_id, fire_date)
```

The job inserts with `ON CONFLICT DO NOTHING`. This makes "exactly one notification per rule, per entity, per day" true even if the job runs twice, retries after a crash, or is triggered manually during UAT — which is exactly when a naive implementation double-sends.

**Email path with Nodemailer.** Each successful insert enqueues an email job on a BullMQ queue consumed by the worker. The transport is a **pooled SMTP connection** (`pool: true`, bounded `maxConnections` / `maxMessages`) — pooling matters more here than with an HTTP API, because a daily batch can produce a burst of sends and most SMTP providers rate-limit per connection. Failures retry with exponential backoff (5 attempts), and every attempt lands in `notification_deliveries` with the SMTP response, `messageId`, and the `accepted`/`rejected` arrays Nodemailer returns. A permanent rejection (5xx) fails fast rather than consuming all five attempts; only transient errors (4xx, timeouts, connection resets) retry.

**The in-app notification is committed before the email is attempted**, satisfying "a failure never blocks the in-app notification".

### 1.7 Dashboard performance (DSH acceptance: < 2 s)

Eight widgets = one `GET /api/dashboard` returning all eight, computed by a small number of grouped aggregate queries, cached in Redis under `dash:{role}:{userId}` with a 5-minute TTL and **explicit invalidation** on writes to vehicles, maintenance ops, documents and damages. The cold path is the real target: measure against a seeded reference dataset (§7, Q2: 250 vehicles / 40 users) in FF-1204 and add indexes from actual query plans rather than guessing up front.

---

## 2. Data model

Refines PRD §6.1 with the decisions in §7. All tables carry `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`.

```
users                id, name, email (unique, citext), password_hash, role,
                     is_active, last_login_at, deactivated_at, deleted_at
password_resets      id, user_id, token_hash, expires_at, used_at        -- AUTH-02
drivers              id, user_id? (unique, nullable), first_name, last_name,
                     licence_no, licence_category, licence_expiry, phone,
                     hired_at, status, deleted_at
vehicle_types        id, name, description                               -- MNT-04 plan scope
vehicles             id, plate (unique), vin (unique, nullable), make, model, year,
                     vehicle_type_id, status(active|under_maintenance|archived),
                     current_mileage, purchase_date, purchase_price,
                     insurance_value, notes, archived_at, deleted_at
mileage_readings     id, vehicle_id, mileage, recorded_at, recorded_by,
                     source(manual|maintenance)                          -- VEH-05 audit trail
assignments          id, vehicle_id, driver_id, start_date, end_date?, ended_by
                     -- VEH-03 / DRV-03. Partial unique index on (vehicle_id)
                     -- WHERE end_date IS NULL → one open assignment per vehicle (Q5).
maintenance_plans    id, name, vehicle_id?, vehicle_type_id?, trigger_type(date|mileage|both),
                     interval_days?, interval_km?, notice_days, notice_km,
                     task_template, is_active, deleted_at
                     -- CHECK: exactly one of vehicle_id / vehicle_type_id is set
maintenance_ops      id, vehicle_id, plan_id?, damage_id?, kind(scheduled|unexpected),
                     title, description, status(planned|in_progress|completed|overdue),
                     due_date?, due_mileage?, started_at, completed_at,
                     completed_mileage, mechanic_id?, cost_parts, cost_labour,
                     cost_total (generated: parts + labour), currency, vendor, deleted_at
document_types       id, code, label, default_notice_days, is_active       -- DOC-06
documents            id, vehicle_id, document_type_id, reference_no,
                     issue_date, expiry_date, notice_days, notes, deleted_at
                     -- status (valid|expiring_soon|expired) is DERIVED, never stored
damages              id, vehicle_id, reported_by_user_id, driver_id?, description,
                     severity, occurred_at, location, status(reported|under_review|
                     linked|resolved|rejected), maintenance_op_id?, archived_at, deleted_at
attachments          id, entity_type(document|maintenance_op|damage), entity_id,
                     bucket, object_path, file_name, mime_type, size_bytes,
                     kind(scan|invoice|photo), upload_state(pending|ready),
                     uploaded_by, deleted_at
notifications        id, user_id, rule, entity_type, entity_id, fire_date,
                     title, body, link_url, read_at
                     -- UNIQUE (user_id, rule, entity_type, entity_id, fire_date)
notification_deliveries id, notification_id, channel(email), status(queued|sent|failed),
                     smtp_message_id, smtp_response, error, attempts, last_attempt_at
audit_log            id, actor_user_id, action, entity_type, entity_id,
                     changes jsonb, ip, created_at
settings             key (pk), value jsonb   -- notice periods, send time, currency
```

Four deliberate departures from the PRD sketch, each with a reason:

- **`deleted_at` on every business table (Q6).** Soft delete is now the confirmed rule. Prisma gets a global query extension that appends `deleted_at IS NULL` to every read, so a repository cannot forget it. `DELETE` endpoints set the timestamp; only admin-initiated user purges with zero authored records hard-delete.
- **`document.status` is computed, not stored.** A stored status is wrong the moment the clock passes midnight and nothing writes to the row. Deriving it in SQL from `expiry_date` and `notice_days` means DOC-05 and the dashboard can never disagree.
- **`mileage_readings` is a table, not a column.** VEH-05 makes mileage a maintenance trigger; a single mutable column cannot answer "what was the mileage when this became due", and cannot survive correcting a typo without destroying the trigger history.
- **`audit_log` is not in the PRD.** It is cheap now (one interceptor in the service layer) and impossible to retrofit for past events. Recommended P1.

---

## 3. API surface

REST, `/api/v1`, JSON. Every list endpoint takes `?page&pageSize&sort&q` plus module filters, and returns `{ data, page, pageSize, total }`.

```
POST   /auth/login · /auth/refresh · /auth/logout
POST   /auth/forgot-password · /auth/reset-password
GET    /auth/me

GET/POST       /users            PATCH/DELETE /users/:id      POST /users/:id/deactivate
GET/POST       /drivers          GET/PATCH/DELETE /drivers/:id
GET/POST       /vehicles         GET/PATCH/DELETE /vehicles/:id
POST           /vehicles/:id/archive
GET/POST       /vehicles/:id/mileage
GET            /vehicles/:id/overview        -- VEH-02, the 4-section aggregate
GET/POST       /assignments      PATCH /assignments/:id/close
GET/POST       /maintenance-plans            GET/PATCH/DELETE /maintenance-plans/:id
GET/POST       /maintenance      GET/PATCH /maintenance/:id
PATCH          /maintenance/:id/status       POST /maintenance/:id/assign
GET/POST       /documents        GET/PATCH/DELETE /documents/:id
GET/POST       /damages          GET/PATCH/DELETE /damages/:id
POST           /damages/:id/convert-to-maintenance   -- DMG-02
POST           /attachments/upload-url       POST /attachments/:id/confirm
GET            /attachments/:id/download-url
GET            /notifications    POST /notifications/:id/read   POST /notifications/read-all
GET            /dashboard
GET            /reports/{maintenance-history|cost-by-vehicle|cost-by-period|
                          driver-assignments|expiring-documents}
GET            /reports/:name/export?format=csv|xlsx|pdf
GET/PATCH      /settings                     -- admin only
```

Errors are uniform: `{ error: { code, message, details? } }`, `code` machine-readable. Validation returns 422 with field paths from Zod. **Authorisation failures return 403 and authentication failures 401 — never 404-as-obfuscation**, so the AUTH-06 acceptance criterion is directly testable.

OpenAPI 3.1 is **generated from the shared Zod schemas** (`zod-to-openapi`), not written by hand. The "API documentation" deliverable therefore cannot go stale.

---

## 4. Frontend plan

- **Language: English only** (Q7). No i18n library, no translation files, no RTL. User-facing strings live in the components. A light `lib/format.ts` still centralises currency, date and number formatting, reading currency from `settings` — that is formatting, not translation, and it keeps cost figures consistent between the dashboard, reports and exports.
- **Shell:** persistent sidebar + topbar, role-filtered navigation from `MATRIX`, notification bell with unread badge, user menu. Route guards read the same matrix.
- **Reusable primitives built once, before the module screens** — this is where parallel-team leverage comes from:
  `DataTable` (server pagination/sort/filter, wired to TanStack Query), `EntityForm` (react-hook-form + shared Zod schema), `FileUploadField` (the signed-URL dance from §1.5), `StatusBadge`, `DateRangePicker`, `ConfirmDialog`, `EmptyState`, `PageHeader`. Each of the ten modules is then assembled rather than written.
- **Screens:** Login · Forgot/Reset · Dashboard · Vehicles list/detail(4 tabs)/form · Drivers · Assignments · Maintenance list + board + detail · Maintenance plans · Documents · Damages + driver report form · Notifications centre · Reports (5 + export) · Users · Settings.
- **Role-specific landings:** a Driver sees their vehicle, its upcoming maintenance and a "report a problem" button — not an empty admin dashboard. A Mechanic lands on their assigned task queue.
- **Responsive to 360 px.** The PRD excludes a _native_ mobile app; drivers and mechanics will still use phones, and a driver damage report typed at the roadside is the most mobile-critical flow in the product.
- **Design tokens** (palette, logo, typography) are applied as CSS variables once the Figma design signs off, so screen work does not wait on it — build against a neutral shadcn theme and swap the variables.

---

## 5. Testing and quality

> **Timing (client decision, 8 Aug 2026): all of this is written in E12, after the
> features are built.** The levels below still describe what gets written and why;
> only _when_ has changed. E1 and the completed parts of E2 already carry their
> tests — 353 of them — and those stay in CI throughout.
>
> Three consequences to hold in mind while building:
>
> 1. **"Done" now means "runs", not "known correct".** A task closes when the code
>    works by inspection. Whether it is right is an open question until E12.
> 2. **Defects compound.** A wrong assumption in the trigger engine or the scope
>    resolvers will have callers built on top of it before anyone notices, so the
>    fix is rework rather than an edit.
> 3. **CI still runs on every PR** — typecheck, lint, format, build, and the
>    existing 353 tests. That catches type and contract breakage immediately, which
>    is a real safety net; it is just a much narrower one than behavioural tests.

| Level       | Tool                           | Coverage target                                                                                                                   |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                         | Rule engine (date/mileage triggers, overdue), cost math, document status derivation, scope resolvers, soft-delete query extension |
| Integration | Supertest + throwaway Postgres | Every endpoint, happy path + authorisation. **Includes the generated 7×5×4 permission matrix test.**                              |
| E2E         | Playwright                     | Five journeys, one per role, end to end                                                                                           |
| Manual      | UAT script                     | Written before QA begins and agreed with the client — the PRD flags "undefined acceptance criteria for UAT" as a risk             |

CI on every PR: typecheck → lint → unit → integration (against service containers) → build. Merge blocked on green.

---

## 6. Delivery sequencing

By dependency, not by date. Six stages; each is a coherent demoable increment.

| Stage                           | Contents                                                                                                                    | Est (person-days)  | Gate                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| **0. Decisions**                | Remaining confirmations, Supabase + SMTP account access                                                                     | 1.4                | Permission matrix signed off; SMTP credentials working                 |
| **1. Foundation**               | Monorepo, Prisma schema + first migration, Express skeleton, CI, shared package, auth + RBAC, web shell + component library | 15.0               | A user can log in; a protected endpoint returns 403 for the wrong role |
| **2. Core entities**            | Users, drivers, vehicles, assignments, mileage, storage layer                                                               | 11.5               | A vehicle exists with a driver assigned and its history visible        |
| **3. Operational modules**      | Maintenance (plans, ops, trigger engine), documents, damages                                                                | 11.8               | A mileage entry generates a task; a document shows "expiring soon"     |
| **4. Cross-cutting**            | Notifications, dashboard, reports and exports                                                                               | 10.2               | The daily job sends real email; exports reconcile with the dashboard   |
| **5. Testing & hardening**      | **All tests for stages 2–4**, plus E2E, security review, performance, UAT support, and defect remediation                   | **15.8 + FF-1208** | All P0 acceptance criteria demonstrated                                |
| **6. Documentation & handover** | OpenAPI, schema doc, admin guide, user manual, training, code handover                                                      | 2.8                | Deliverables accepted                                                  |
|                                 | **Total**                                                                                                                   | **≈ 64 + FF-1208** |                                                                        |

Stages 2–4 shed ≈11 days by dropping inline tests; stage 5 absorbs ≈9.5 of them
back. The gates for stages 2–4 are now **demonstrations, not proofs** — "a mileage
entry generates a task" means someone watched it happen once, not that the trigger
engine is correct across edge cases. That verification moves to stage 5.

**Ordering constraints that cannot be reordered:**

- Schema (FF-103) before everything — the soft-delete and single-assignment decisions are baked into it.
- RBAC (FF-205) before any module endpoint; retrofitting scope resolvers across ten modules is far more expensive than having them from the start.
- Vehicles (FF-401) before maintenance, documents and damages — all three hang off it.
- Maintenance and documents before notifications — the rule engine reads both.
- Everything before reports — reports read all of it.

Four tasks are worth watching closely, since each blocks a wide fan-out: **FF-103** (schema), **FF-205** (RBAC), **FF-401** (vehicles), **FF-503** (trigger engine — the highest logical complexity in the project).

---

## 7. Decisions

### 7.1 Resolved by the client, 7 August 2026

| #   | Question                                 | **Decision**                                                              | Consequence in the build                                                                                                                                                                                                                      |
| --- | ---------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q5  | Multiple concurrent drivers per vehicle? | **No — one driver per vehicle.** A driver may still hold several vehicles | Partial unique index on `assignments(vehicle_id) WHERE end_date IS NULL`. "The vehicle's driver" is a single-valued lookup everywhere, including notification recipients                                                                      |
| Q6  | Hard or soft delete?                     | **Soft delete, all modules**                                              | `deleted_at` on every business table + a global Prisma query extension appending `deleted_at IS NULL`. Delete endpoints never destroy data; VEH-01's "deletion blocked when linked records exist" becomes a soft-delete with the links intact |
| Q7  | Language(s) and RTL?                     | **English only. No translation layer**                                    | No i18n library, no locale files, no RTL. Saves ~0.5 person-days directly and more in QA. Adding a language later is a change request that re-tests every screen                                                                              |
| —   | Email provider                           | **Nodemailer over SMTP** (replaces Resend)                                | Pooled SMTP transport in the worker; delivery log stores SMTP response and message id; templates rendered to HTML and transport-agnostic                                                                                                      |
| —   | Hosting / deployment                     | **Out of scope for this plan**                                            | All infrastructure bindings are env vars; no host-specific code or config                                                                                                                                                                     |
| —   | Timeline                                 | **Proposal timeline disregarded**                                         | Estimates are person-days; sequencing is by dependency (§6)                                                                                                                                                                                   |

### 7.2 Defaults applied — flag now if any is wrong

| #   | Question                                           | Proposed default                                                                                                                          | Cost to change later                              |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Q1  | Permission matrix (PRD §2.1)                       | As written in the PRD; **needs explicit client sign-off** — it is marked there as NovaTech's interpretation                               | Low if caught before FF-205; it is one data table |
| Q2  | Fleet size / concurrent users                      | 250 vehicles, 40 users at launch; 500/80 at 12 months. Used as the performance reference dataset                                          | Low — affects tuning only                         |
| Q3  | Full attribute lists                               | As modelled in §2                                                                                                                         | Low — additive columns are cheap                  |
| Q4  | Notification notice periods, send time, recipients | Documents 30/15/7 days · maintenance 14/7/1 days and 500 km · 07:00 local · recipients per §1.6. All stored in `settings`, admin-editable | Low — settings, by design                         |
| Q8  | Currency and number format                         | Single currency in `settings`, default **USD**, `en-US` formatting                                                                        | Low                                               |
| Q9  | Supported browsers                                 | Latest 2 of Chrome, Firefox, Edge, Safari — **fix this in writing**, since the warranty references it                                     | Contractual                                       |
| Q10 | Data migration                                     | Out of scope per PRD §10. A CSV importer would be ~3 extra person-days and a change request                                               | —                                                 |
| Q12 | Uploads                                            | 20 MB max; `pdf, jpg, png, webp, heic` for scans and photos; `pdf` for invoices                                                           | Low                                               |
| Q13 | Account ownership                                  | Client owns the Supabase and SMTP accounts; NovaTech gets delegated access during the build                                               | Commercial                                        |
| Q15 | Audit logging                                      | Include `audit_log` as P1                                                                                                                 | Medium — past events cannot be reconstructed      |

---

## 8. Risks

| Risk                                              | Why it matters here                                                                                                                                                                                                              | Mitigation                                                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorisation bugs across 5 roles × 7 modules** | Highest-severity defect class. A Driver reading the whole fleet is a breach, not a bug                                                                                                                                           | Central matrix (§1.4) + generated 140-case test (FF-206) + scoping enforced in repositories                                                                                                                                                     |
| **Duplicate notification emails**                 | Kills trust within a week; users mute the sender and DOC-04 silently stops working                                                                                                                                               | DB unique constraint, not app logic (§1.6). Never cut this — it is one line of SQL                                                                                                                                                              |
| **SMTP deliverability**                           | Expiry reminders landing in spam is the PRD's "core value proposition fails silently". Self-hosted or unauthenticated SMTP is materially worse at this than an API provider, so this risk went **up** with the Nodemailer switch | Authenticate the sending domain (SPF, DKIM, DMARC) before build ends; use a reputable SMTP relay rather than a raw mail server; log every delivery; monitor `rejected` during UAT; in-app notification as fallback                              |
| **SMTP burst limits on the daily batch**          | The daily job can emit hundreds of emails in one minute and get throttled or temporarily blocked                                                                                                                                 | Pooled transport with bounded concurrency, BullMQ rate limiting, exponential backoff, 5xx-fails-fast                                                                                                                                            |
| **Scope breadth (ten modules, ~65 person-days)**  | Whatever schedule is agreed, this is the number to plan against                                                                                                                                                                  | §6 stages; P0 before P1; ~9 person-days of P1 are droppable (except the dedupe constraint)                                                                                                                                                      |
| **Deferred testing (decision, 8 Aug 2026)**       | ≈24% of remaining effort now sits in one late block, and FF-1208's remediation is unestimated. Defects arrive together, late, with no slack behind them; structural ones mean rework rather than edits                           | Re-forecast FF-1208 as soon as FF-1206 and FF-1201 report — the first point real evidence exists. Keep CI green throughout, so type and contract breakage is still caught immediately. If E12 overruns, the honest lever is scope, not coverage |
| **Trigger engine correctness (FF-503)**           | Silent wrong behaviour — a task that never generates looks identical to a fleet with nothing due. **Now the sharpest instance of the deferred-testing risk**                                                                     | Unit tests against a fixed clock and idempotency proven by running the job twice — both moved to FF-1206, so this stays unverified until E12                                                                                                    |
| **Export fidelity (RPT-06)**                      | "Exported figures reconcile with the dashboard" — three formats, one truth                                                                                                                                                       | One query → one result set → three serialisers. Reconciliation asserted in tests                                                                                                                                                                |
| **Scope creep from PRD §3.2** (GPS, fuel, mobile) | Excluded from the fixed price and the warranty                                                                                                                                                                                   | Written change request and re-quote                                                                                                                                                                                                             |

---

## 9. Definition of done

**Per task** _(revised 8 Aug 2026 — tests deferred to E12)_: code merged with CI
green (typecheck, lint, format, build, existing suite) · behaviour demonstrated
manually at least once · authorisation applied via `authorize()` with the correct
scope · soft delete respected · no `any` in new code · responsive to 360 px.

The dropped clauses — "unit + integration tests for new logic", "authorisation
asserted for all five roles" — are not abandoned; they become entry criteria for
E12 instead. FF-1207 in particular exists to restore the five-role assertion
across every shipped endpoint.

**Per project** (PRD §13, minus the deployment items now out of scope):

- [ ] All P0 requirements demonstrated
- [ ] UAT script executed and signed off by the client
- [ ] Security review completed (auth, authorisation, upload handling, transport)
- [ ] Notification jobs verified end to end, in-app and email
- [ ] Documentation delivered: database schema, API docs, administrator guide, user manual
- [ ] Training session delivered
- [ ] Source code handed over
- [ ] Final acceptance signed — 90-day warranty period begins
