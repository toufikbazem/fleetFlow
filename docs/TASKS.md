# FleetFlow MVP — Task Breakdown

Companion to [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). 12 epics, 58 tasks, **≈64 person-days plus FF-1208** (see the totals table — FF-1208 has no estimate by design).

**Legend** — `Est` in person-days · `P` = priority (P0 blocks release, P1 required for a P0 to work, P2 optional) · `PRD` traces to the PRD requirement id · `Dep` = must finish first · `Track` = suggested owner (**BE** backend, **FE** frontend, **FS** full-stack, **DES** design)

> **Not in this breakdown** (client direction, 7 Aug 2026): hosting, deployment, environment provisioning, backup policy, and any calendar schedule. Sequencing is by dependency — see plan §6 for the six stages.

> ### ⚠️ Testing is deferred to the end — client decision, 8 Aug 2026
>
> All remaining build tasks are **code only**. No tests are written alongside them.
> Every test is instead written in **E12**, after the features are complete.
>
> **What this changes.** Build tasks shrink by about 25% — roughly **11 days
> saved**. E12 grows from 6.25 to **15.75 person-days** to absorb that work, and
> gains FF-1208, fixing whatever the tests find, which **cannot be estimated in
> advance**.
>
> The saving and the growth very nearly cancel: the total stays near 65 days,
> **plus** the unbounded remediation task. Deferring tests does not reduce the
> work — it moves it, adds a penalty for testing code written weeks earlier
> (~1.4×, because the author has to re-read it first), and converts a known cost
> into an unknown one.
>
> **What it means in practice.** Between now and E12, "done" means the code runs,
> not that it is known to be correct. Defects will accumulate silently and surface
> together, late, when more code depends on them. Three bugs found this week —
> a missing database default that broke every non-Prisma write, an `.env`
> resolution fault that stopped `npm run dev:api` entirely, and a constraint test
> that silently checked nothing — were each fixed in minutes because a test ran
> immediately. Under this plan their equivalents surface in E12 instead.
>
> This is a deliberate, recorded trade: faster visible progress now, a larger and
> less predictable block at the end. It was raised, discussed, and chosen.
>
> **The 353 tests already written stay** and keep running in CI. Nothing is deleted.

---

## E0 — Decisions & access ⛔ BLOCKING

Q5 (one driver per vehicle), Q6 (soft delete) and Q7 (English only) are **resolved** — see plan §7.1. What remains still blocks the schema and the mailer.

| ID     | Task                                                                                                                                                            | Est  | P   | PRD     | Dep    | Track |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ------- | ------ | ----- |
| FF-002 | Confirm the §2.1 permission matrix cell by cell with the client. It is marked in the PRD as an unconfirmed interpretation, and it is the direct input to FF-205 | 0.25 | P0  | §2.1    | —      | FS    |
| FF-003 | Agree notification notice periods, daily send time and recipient rules per role                                                                                 | 0.25 | P0  | NTF     | —      | FS    |
| FF-004 | Obtain Supabase project access (DB + Storage) and **SMTP credentials** (host, port, user, password, from-address)                                               | 0.25 | P0  | §10     | —      | FS    |
| FF-005 | Authenticate the sending domain — SPF, DKIM, DMARC — and prove a test send arrives in an inbox, not spam                                                        | 0.5  | P0  | Risk §8 | FF-004 | FS    |
| FF-006 | Fix the supported-browser list in writing (the warranty references it)                                                                                          | 0.1  | P0  | §5      | —      | FS    |

**Subtotal 1.35**

---

## E1 — Foundation

| ID     | Task                                                                                                                                                                                                                                                         | Est | P   | PRD  | Dep            | Track |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | ---- | -------------- | ----- |
| FF-101 | Monorepo scaffold: npm workspaces, `apps/api`, `apps/web`, `packages/shared`, TS project refs, ESLint + Prettier, commit hooks                                                                                                                               | 0.5 | P0  | §6   | —              | FS    |
| FF-102 | Local dev environment: `compose.dev.yml` (Postgres 16, Redis 7), `.env.example`, **boot-time env validation** so a missing `SMTP_HOST` fails loudly instead of at 07:00                                                                                      | 0.5 | P0  | §6   | FF-101         | BE    |
| FF-103 | **Prisma schema v1** — all 16 tables from plan §2, indexes, CHECK constraints, `deleted_at` everywhere (Q6), partial unique index on open assignments (Q5), notification dedupe unique. First migration + seed (roles, document types, settings, demo fleet) | 1.5 | P0  | §6.1 | FF-102         | BE    |
| FF-104 | Express 5 skeleton: pino logging + request ids, uniform error envelope, Zod validation middleware, CORS, helmet, `/healthz`                                                                                                                                  | 1.0 | P0  | §6   | FF-101         | BE    |
| FF-105 | **Soft-delete query extension** — a global Prisma extension appending `deleted_at IS NULL` to every read, plus an explicit `withDeleted()` escape hatch for reports and audit. Unit-tested across all models                                                 | 0.5 | P0  | Q6   | FF-103         | BE    |
| FF-106 | CI pipeline: typecheck → lint → unit → integration (service containers) → build; merge blocked on green                                                                                                                                                      | 0.5 | P0  | —    | FF-104         | FS    |
| FF-107 | `packages/shared`: Zod schemas + inferred types, `MATRIX`, status enums, notification rule ids                                                                                                                                                               | 0.5 | P0  | §2.1 | FF-101, FF-002 | FS    |

**Subtotal 5.0**

---

## E2 — Authentication & authorisation

The security spine. Everything else assumes it works.

FF-201, FF-202, FF-206 and FF-207 are **complete, with tests** — they were built
before the 8 Aug decision. The three remaining tasks are code only; their
estimates below are reduced accordingly.

| ID     | Task                                                                                                                                                                                                             | Est  | P   | PRD              | Dep            | Track |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ---------------- | -------------- | ----- |
| FF-201 | Login: bcrypt verify (cost 12), JWT access token (15 min), opaque refresh token in an httpOnly cookie. **Generic error on failure — never reveals whether the account exists**                                   | 1.0  | P0  | AUTH-01, AUTH-03 | FF-103, FF-104 | BE    |
| FF-202 | Refresh rotation + logout: Redis `refresh:{jti}` store, rotation on use, access-token `jti` denylist on logout                                                                                                   | 0.75 | P0  | AUTH-04          | FF-201         | BE    |
| FF-203 | **Nodemailer platform module** _(code only)_: pooled SMTP transport, verified at boot, React Email → HTML rendering, plain-text alternative, dev-mode console/preview transport so local work needs no real SMTP | 0.6  | P0  | §6               | FF-004, FF-104 | BE    |
| FF-204 | Password reset _(code only)_: single-use hashed token, 60-min expiry, email via FF-203, replay rejected                                                                                                          | 0.6  | P0  | AUTH-02          | FF-203         | BE    |
| FF-205 | Rate limiting (Redis sliding window) + progressive lockout after repeated failures _(code only)_                                                                                                                 | 0.4  | P1  | AUTH-05          | FF-201         | BE    |
| FF-206 | **RBAC middleware + scope resolvers** — `authorize(module, action)` reading `MATRIX`, plus repository-level `where` fragments for `R_OWN` / `R_SELF` / `W_ASSIGNED` / `W_REPORT`                                 | 1.5  | P0  | AUTH-06, §2.1    | FF-107, FF-201 | BE    |
| FF-207 | **Generated permission matrix test** — 7 modules × 5 roles × 4 verbs asserting exact status codes, plus the auth unit/integration suite                                                                          | 1.0  | P0  | AUTH acceptance  | FF-206         | BE    |

**Subtotal 5.85** _(was 6.25; FF-201/202/206/207 already delivered with tests)_

---

> **Everything from here to E11 is code only.** Tests for all of it live in E12.

---

## E3 — Users & drivers

| ID     | Task                                                                                            | Est  | P   | PRD            | Dep                     | Track |
| ------ | ----------------------------------------------------------------------------------------------- | ---- | --- | -------------- | ----------------------- | ----- |
| FF-301 | Users CRUD (admin-only), role assignment, deactivate-without-delete preserving authored records | 1.0  | P0  | USR-01,02,03   | FF-206                  | BE    |
| FF-302 | Invitation / initial-password flow for new accounts                                             | 0.75 | P1  | USR-04         | FF-204, FF-301          | BE    |
| FF-303 | Drivers CRUD, licence fields, soft delete, optional link to a Driver-role user account          | 1.0  | P0  | DRV-01, DRV-04 | FF-206                  | BE    |
| FF-304 | Users + Drivers UI: list, create/edit forms, deactivate confirm, role selector                  | 1.5  | P0  | USR, DRV       | FF-1102, FF-301, FF-303 | FE    |

**Subtotal 3.2** _(code only; 4.25 with tests)_

---

## E4 — Vehicles & assignments

The hub entity. Blocks E5, E6, E7.

| ID     | Task                                                                                                                                                                                                                                  | Est  | P   | PRD                    | Dep             | Track |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ---------------------- | --------------- | ----- |
| FF-401 | Vehicles CRUD, status lifecycle (active → under_maintenance → archived), soft delete; deleting a vehicle with linked maintenance or damage records preserves both sides of the link                                                   | 1.25 | P0  | VEH-01, VEH-06         | FF-206, FF-105  | BE    |
| FF-402 | Vehicle list: search, filters (status, driver, type), sort, pagination                                                                                                                                                                | 0.75 | P1  | VEH-04                 | FF-401          | BE    |
| FF-403 | Mileage readings: record endpoint, history, validation against the last reading                                                                                                                                                       | 0.75 | P0  | VEH-05                 | FF-401          | BE    |
| FF-404 | Assignments: open/close with date ranges; reassignment **closes** the prior record rather than overwriting it; **one open assignment per vehicle enforced by partial unique index** (Q5), with a clear 409 when a second is attempted | 1.0  | P0  | DRV-02, DRV-03, VEH-03 | FF-401, FF-303  | BE    |
| FF-405 | `GET /vehicles/:id/overview` — driver history + maintenance schedule + maintenance history + document status in one response                                                                                                          | 0.75 | P0  | VEH-02                 | FF-401, FF-404  | BE    |
| FF-406 | Vehicle UI: list with filters, detail page with the four aggregate tabs, create/edit form, archive action, mileage entry                                                                                                              | 2.0  | P0  | VEH-02, VEH-04         | FF-1102, FF-405 | FE    |

**Subtotal 4.9** _(code only; 6.5 with tests)_

---

## E5 — Maintenance

Largest epic. The trigger engine (FF-503) is the highest-risk single task in the project.

| ID     | Task                                                                                                                                                                                                            | Est  | P   | PRD                    | Dep             | Track |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ---------------------- | --------------- | ----- |
| FF-501 | Maintenance plans: reusable per vehicle **or** per vehicle type, trigger by date / mileage / both, intervals and notice thresholds                                                                              | 1.25 | P0  | MNT-04                 | FF-401          | BE    |
| FF-502 | Maintenance ops CRUD, scheduled vs. unexpected, status workflow with legal transitions only, mechanic assignment                                                                                                | 1.5  | P0  | MNT-01, MNT-06, MNT-07 | FF-501          | BE    |
| FF-503 | **Trigger engine**: generate upcoming ops when a date window opens or recorded mileage crosses a threshold; mark past-due ops `overdue`. Idempotent — safe to run repeatedly. Unit-tested against a fixed clock | 1.5  | P0  | MNT-02, MNT-06         | FF-501, FF-403  | BE    |
| FF-504 | Cost fields (parts, labour, generated total, currency) + invoice/photo attachments on an operation                                                                                                              | 0.75 | P0  | MNT-03, MNT-05         | FF-502, FF-601  | BE    |
| FF-505 | Maintenance UI: list + status board, detail with costs and attachments, plan editor, **mechanic task queue** (assigned-only view)                                                                               | 2.5  | P0  | MNT-01…07              | FF-1102, FF-502 | FE    |

**Subtotal 5.6** _(code only; 7.5 with tests)_

> FF-503, the trigger engine, is the task this decision costs most. Its failure
> mode is silence: a reminder that never fires looks exactly like a fleet with
> nothing due. Without unit tests against a fixed clock, nothing reveals that
> until E12 — or until a customer misses an inspection.

---

## E6 — Documents & file storage

| ID     | Task                                                                                                                                                                                                             | Est  | P   | PRD            | Dep             | Track |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | -------------- | --------------- | ----- |
| FF-601 | **Supabase Storage layer**: signed upload URL issuance with mime/size allowlist, post-upload HEAD verification, signed download URLs, private buckets, `attachments` lifecycle. Shared by DOC-02, MNT-03, DMG-04 | 1.25 | P0  | DOC-02         | FF-104, FF-004  | BE    |
| FF-602 | Documents CRUD against a vehicle + configurable `document_types` reference list with per-type default notice days                                                                                                | 1.0  | P0  | DOC-01, DOC-06 | FF-401, FF-601  | BE    |
| FF-603 | Derived status (valid / expiring soon / expired) computed in SQL from expiry date + notice period; per-document override; aggregate status for the vehicle overview                                              | 0.75 | P0  | DOC-03, DOC-05 | FF-602          | BE    |
| FF-604 | Documents UI: list with status chips, upload with progress, preview/download, expiry filters, vehicle document panel                                                                                             | 1.5  | P0  | DOC-01…05      | FF-1102, FF-603 | FE    |

**Subtotal 3.4** _(code only; 4.5 with tests)_

---

## E7 — Damages

| ID     | Task                                                                                                                                                | Est  | P   | PRD            | Dep             | Track |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | -------------- | --------------- | ----- |
| FF-701 | Damages CRUD + archive; **driver scope** — a driver may report only against their currently assigned vehicle and may not edit others' reports       | 1.0  | P0  | DMG-01, DMG-03 | FF-206, FF-404  | BE    |
| FF-702 | `POST /damages/:id/convert-to-maintenance` — creates a linked unexpected operation, visible from both records                                       | 0.75 | P0  | DMG-02         | FF-701, FF-502  | BE    |
| FF-703 | Photo attachments on damage reports (multi-file)                                                                                                    | 0.5  | P1  | DMG-04         | FF-601, FF-701  | BE    |
| FF-704 | Damages UI: manager queue with triage, damage detail with the linked op, **mobile-first driver report form** (photo capture, description, severity) | 1.5  | P0  | DMG-01…04      | FF-1102, FF-702 | FE    |

**Subtotal 2.8** _(code only; 3.75 with tests)_

---

## E8 — Notifications ✅

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                | Est  | P   | PRD            | Dep                    | Track |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | -------------- | ---------------------- | ----- |
| FF-801 | Notification domain: table + **`UNIQUE (user_id, rule, entity_type, entity_id, fire_date)`**, `ON CONFLICT DO NOTHING` insert, recipient resolver by role and vehicle relationship                                                                                                                                                                                                  | 1.0  | P0  | NTF-07         | FF-103, FF-206         | BE    |
| FF-802 | Rule engine: the four triggers (maintenance upcoming, document expiring, inspection due, maintenance overdue), reading notice periods from `settings`                                                                                                                                                                                                                               | 1.5  | P0  | NTF-01…04      | FF-801, FF-503, FF-603 | BE    |
| FF-803 | BullMQ worker process + repeatable daily job at the configured local time; admin re-run endpoint for UAT; **idempotency proven by running the job twice in test**                                                                                                                                                                                                                   | 0.75 | P1  | NTF-05         | FF-802                 | BE    |
| FF-804 | **Email delivery via Nodemailer**: one React Email template per rule, BullMQ send queue with bounded concurrency and rate limiting, exponential-backoff retry (5 attempts), 5xx fails fast while transient errors retry, `notification_deliveries` log capturing `messageId`, SMTP response and `rejected` recipients. **In-app notification commits before the send is attempted** | 1.5  | P0  | NTF acceptance | FF-203, FF-803         | BE    |
| FF-805 | Notification centre: list / unread-count / mark-read API + bell badge, dropdown, full page, deep links to the source entity                                                                                                                                                                                                                                                         | 1.25 | P1  | NTF-06         | FF-1102, FF-801        | FS    |

**Subtotal 4.5** _(code only; 6.0 with tests)_

> FF-803's idempotency check — running the daily job twice and proving it does
> not double-send — was a test, so it moves to E12. Until then, NTF-07's
> guarantee rests on the database constraint alone. That constraint is real and
> was verified in FF-103, so the risk here is lower than it looks.
>
> **Delivered 14 Aug 2026.** Two deviations, both deliberate:
>
> 1. **node-cron + the database as the queue, not BullMQ.**
>    `notification_deliveries` is a log the NTF acceptance criteria already
>    require. Making it the queue as well gives one source of truth instead of
>    two that can disagree after a crash. Redis stays in use for sessions and
>    caching. Two workers running at once is still safe: NTF-07's unique index
>    lets exactly one set of rows through.
> 2. **No React Email.** The templates are plain functions returning HTML and a
>    text alternative — four short messages did not justify a render pipeline.
>
> Verified live: two consecutive runs produced **10 created / 0 skipped**, then
> **0 created / 10 skipped**. Scoping per recipient came out as designed —
> accountant 0, driver 1 (their own vehicle's inspection), mechanic 2 (their
> assigned jobs). Reading another user's notification returns 404, not 403, so
> the endpoint does not confirm that the id exists.

---

## E9 — Dashboard ✅

| ID     | Task                                                                                                                                                                                         | Est  | P   | PRD            | Dep                    | Track |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | -------------- | ---------------------- | ----- |
| FF-901 | Aggregate queries for all 8 widgets in one endpoint, role-scoped; Redis cache keyed by role+user, 5-min TTL, explicit invalidation on writes to vehicles / maintenance / documents / damages | 1.25 | P0  | DSH-01…08      | FF-401, FF-502, FF-603 | BE    |
| FF-902 | Dashboard UI: 8 widgets, **every counter drills through to the matching filtered list**, monthly cost summary chart, role-specific driver and mechanic landings                              | 1.5  | P0  | DSH acceptance | FF-1102, FF-901        | FE    |

**Subtotal 2.1** _(code only; 2.75 with tests)_

> **Delivered 14 Aug 2026.** Four decisions worth recording:
>
> 1. **Each counter carries the query that produced it.** The server emits
>    `{ value, filter }`; the client owns only the route path. "Every counter
>    drills through to the corresponding filtered list" is otherwise satisfied by
>    two pieces of code independently deciding what "overdue" means, which is how
>    a dashboard ends up reading 7 and opening a list of 5.
> 2. **Overdue is computed, not read from `status`.** The sweep writes OVERDUE
>    once a day, so a stored status makes the answer depend on when the worker
>    last ran. The definition now lives in `maintenance/due-buckets.ts` and is
>    used by the dashboard, the `?due=` list filter and the notification rules.
> 3. **Invalidation is a generation counter, not a key sweep**, and it is applied
>    by middleware rather than by a call in each service — see `dashboard/cache.ts`.
> 4. **A ninth counter, "expired documents."** Not in the PRD's eight. A document
>    that expired yesterday leaves the DSH-06 bucket, so shipping only the eight
>    would have made the most serious case the only invisible one.
>
> Two existing behaviours changed as a consequence, both to remove a drift the
> drill-through would otherwise have exposed:
>
> - `GET /documents` now hides archived vehicles' documents by default
>   (`includeArchived=true` restores them; naming a `vehicleId` overrides it).
>   It previously listed them while the vehicle list hid the vehicles themselves.
> - `GET /maintenance` accepts `?due=upcoming|overdue`.
>
> Verified live: **33 of 33 counter/list pairs reconciled** across all five
> roles. Cache behaved as designed — hit, retired by a write to
> vehicles/maintenance, left alone by a read, by a rejected write, and by a
> write to `/users`. Cold path 35 ms, cached 6–11 ms on seed data; FF-1204 still
> owns the 250-vehicle proof.

---

## E10 — Reports & exports ✅

| ID      | Task                                                                                                                                                                                                                                                                              | Est  | P   | PRD               | Dep              | Track |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- | ----------------- | ---------------- | ----- |
| FF-1001 | Five report queries — maintenance history, cost per vehicle, cost by period, driver assignment history, expiring documents — with shared date-range and vehicle filters. Reports read **through** soft delete where history requires it (an archived vehicle's costs still count) | 1.75 | P0  | RPT-01…05, RPT-07 | FF-901, FF-105   | BE    |
| FF-1002 | Export service: **one query → one result set → three serialisers** (CSV, xlsx via exceljs, PDF via pdfmake with branded header). Reconciliation test against the dashboard cost summary                                                                                           | 1.5  | P0  | RPT-06            | FF-1001          | BE    |
| FF-1003 | Reports UI: report picker, filter bar, results table, three export buttons, empty and loading states                                                                                                                                                                              | 1.5  | P0  | RPT               | FF-1102, FF-1002 | FE    |

**Subtotal 3.6** _(code only; 4.75 with tests)_

> FF-1002's reconciliation check — that an exported figure equals the dashboard's
> for the same period — was a test. RPT-06's acceptance criterion is therefore
> unverified until E12.
>
> **Delivered 14 Aug 2026.** The design decision everything else follows from:
>
> **A report is a table, not five bespoke responses.** Each report returns
> `{ columns, rows, totals }` with a typed `column.type`, so there is _one_
> paginator, _one_ screen and _three_ serialisers — not fifteen combinations
> where a figure can round differently in the PDF than on screen. RPT-06's "all
> three formats from the same filtered result set" is then structural rather
> than a thing to test per report per format. Adding a sixth report is a query.
>
> Supporting decisions:
>
> - **`cost-basis.ts` is the single definition of spend**, imported by DSH-08 and
>   both cost reports. Reconciliation between the dashboard and an export is a
>   promise about two pieces of code agreeing; the only way to keep it is to have
>   one piece of code.
> - **Exports send filters, never rows.** The client posting back its table would
>   let a stale or edited grid become the file.
> - **An export covers the whole filtered set, not the visible page**, capped at
>   50 000 rows — and refuses past the cap rather than silently truncating.
> - **CSV and xlsx carry raw numbers; only the PDF carries formatted text.** A CSV
>   of `"$1,234.50"` is a string no spreadsheet will sum.
> - Downloads go through `apiDownload`, not an `<a href>`: the access token lives
>   in memory, so a bare link would 401 and the user would save the error page.
>
> Verified live, RPT-06 included: dashboard 12-month total **490.50** =
> `cost-by-period` **490.50** = `cost-by-vehicle` **490.50**, matching month by
> month, and the CSV footer equals the JSON totals row. All 15 report×format
> exports produced valid files (`%PDF`, `PK..`, UTF-8 BOM); xlsx read back with
> real `Date` cells and numeric cells carrying `#,##0.00`. **Reports read through
> soft delete**: soft-deleting the vehicle holding all the cost dropped the
> vehicle list 4→3 while history stayed at 4 rows / 1 390.50 and cost at 490.50.
> Mechanic and Driver get **403** on both the report and the export endpoints.
>
> Two things fixed along the way, outside the task text:
>
> - **`nodemailer` bumped 6 → 9.** `npm audit` surfaced 8 advisories against
>   ≤ 9.0.0, one high (SMTP command injection). `node-cron` 3 → 4 for a
>   transitive `uuid` advisory. One moderate remains: `exceljs` → `uuid < 11.1.1`,
>   a bounds check in uuid v3/v5/v6 when a `buf` argument is passed. exceljs uses
>   v4 and passes no buffer, and the only "fix" npm offers is a downgrade to
>   exceljs 3.4.0. Left in place, flagged for FF-1203.
> - **`ModulePlaceholder` deleted from `App.tsx`** — Reports was the last screen
>   using it, so every route now renders a real module.

---

## E11 — Frontend foundation

Front-load this. Every later FE task is assembly on top of it.

| ID      | Task                                                                                                                                                                                                       | Est             | P   | PRD   | Dep            | Track |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --- | ----- | -------------- | ----- |
| FF-1101 | Vite + React 19 + TS app, React Router with role guards from `MATRIX`, app shell (sidebar, topbar, role-filtered nav), login / forgot / reset screens                                                      | 1.5             | P0  | §5 UI | FF-107, FF-201 | FE    |
| FF-1102 | **Component library**: shadcn/ui install, design tokens as CSS variables, then `DataTable`, `EntityForm`, `FileUploadField`, `StatusBadge`, `DateRangePicker`, `ConfirmDialog`, `EmptyState`, `PageHeader` | 2.0             | P0  | §5 UI | FF-1101        | FE    |
| FF-1103 | Typed API client from `packages/shared`, TanStack Query setup, query-key conventions, global error → toast, 401 → refresh → retry interceptor                                                              | 1.0             | P0  | —     | FF-1101        | FE    |
| FF-1104 | `lib/format.ts` — currency, date and number formatting driven by `settings`. **English only, no i18n library** (Q7)                                                                                        | 0.25            | P0  | Q8    | FF-1101        | FE    |
| FF-1105 | Apply the Figma design tokens (palette, logo, typography) once design signs off; responsive pass to 360 px                                                                                                 | _incl. in 1102_ | P0  | §5 UI | FF-1102, DES   | FE    |

**Subtotal 3.6** _(code only; 4.75 with tests)_

---

## E12 — QA & hardening ✅

All testing for E3–E11 lands here, per the 8 Aug decision. Order matters: the
cheap, fast tests run first, because they localise a fault to one function,
while an end-to-end failure only tells you something in a long chain broke.

| ID      | Task                                                                                                                                                                                    | Est   | P   | PRD            | Dep              | Track |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --- | -------------- | ---------------- | ----- |
| FF-1206 | **Unit tests** for the logic with no obvious failure signal: trigger engine against a fixed clock (FF-503), cost arithmetic, derived document status, scope resolvers, mailer rendering | 4.0   | P0  | §13            | E3–E11           | BE    |
| FF-1201 | **API integration suite**: every endpoint, happy path + authorisation, against a throwaway Postgres                                                                                     | 5.0   | P0  | §13            | E3–E10           | BE    |
| FF-1207 | **Permission matrix across real endpoints** — extend FF-207's generated test from probe routes to every shipped route, so each is proven scoped, not just guarded                       | 2.0   | P0  | AUTH-06        | FF-1201          | BE    |
| FF-1202 | **Playwright E2E**: five journeys, one per role (admin onboards → manager schedules → mechanic completes → driver reports → accountant exports)                                         | 2.0   | P0  | §13            | FF-1201          | FS    |
| FF-1203 | Security review: authz/IDOR sweep, upload handling, headers, CORS, secret hygiene, dependency audit                                                                                     | 1.0   | P0  | §13            | FF-1201          | BE    |
| FF-1204 | Performance: seed the reference dataset (250 vehicles), prove **dashboard < 2 s**, add indexes from real query plans, kill N+1s                                                         | 0.75  | P0  | DSH acceptance | FF-901           | BE    |
| FF-1205 | **Write the UAT script and get it agreed before QA begins**, then support client execution and triage                                                                                   | 1.0   | P0  | Risk §8        | —                | FS    |
| FF-1208 | **Defect remediation** — fix everything the tests above uncover, then re-run                                                                                                            | **?** | P0  | §13            | FF-1201, FF-1206 | BE/FS |

**Subtotal 15.75 known, plus FF-1208** _(was 6.25 when tests were written inline)_

> **Delivered 15 Aug 2026.** 1 162 automated checks: 249 unit, 913 integration,
> 31 end-to-end. Gate green — lint, typecheck, unit, integration, build.
>
> Two structural choices shaped the suites:
>
> - **FF-1207's route list is read out of the live Express router**, so "every
>   shipped endpoint is covered" is computed rather than maintained by hand. All
>   80 routes are classified; a new one that nobody classifies fails the suite.
>   That gives 65 guarded routes × 5 roles = 325 matrix cases, plus a 401 check
>   and a forged-token check on every protected route.
> - **The classification is transcribed by hand, not derived from the source.**
>   Deriving it would mean the test and the code share one opinion, and the test
>   could only confirm the code agrees with itself.
>
> ### What the tests found — FF-1208
>
> Five real defects, four of them invisible to every layer below the one that
> caught them:
>
> 1. **A role change did not take effect until the token expired** (USR-02).
>    The code revoked refresh tokens and a comment claimed that was enough; the
>    access token already issued stayed validly signed for up to 15 more minutes.
>    The dangerous direction is a _demotion_. Fixed with a per-user cutoff
>    (`revokeAccessTokensFor`) checked in `requireAuth`; the refresh token
>    deliberately survives, so the client silently re-authenticates and the user
>    is not thrown back to the login screen. Deactivation and deletion now cut
>    off immediately too.
> 2. **Every optional form field rejected a blank submission.** An untouched
>    input submits `''`, and `.optional()` admits only `undefined` — so filling
>    in only the required fields produced seven errors on the vehicle form, each
>    of them nonsense ("Number must be greater than or equal to 1900" on an empty
>    Year). Fixed once in the contract with `optionalField`, applied to 67 fields
>    across seven schemas. Found by the E2E suite; the API was correct in
>    isolation and every schema read fine on its own.
> 3. **A driver could not file a damage report at all** (DMG-03) — the most
>    mobile-critical flow in the product. `useForm` captures `defaultValues` on
>    its first render, before the vehicle list has loaded, so the hidden
>    `vehicleId` submitted empty and the dialog silently did nothing.
> 4. **CSV formula injection.** Vendor names and maintenance titles reach a CSV
>    that an accountant opens in Excel; a cell beginning `=`, `+`, `-` or `@` is
>    executed. Neutralised in `toCsv` only — an xlsx string cell is never
>    evaluated and a PDF is inert — and numbers are left alone so costs stay
>    summable.
> 5. **The daily notification run took 36 s on 250 vehicles.** Two causes: a
>    recipient lookup per matched entity, and a read-back query with one `OR`
>    branch per pending row (9 231 of them). Fixed with a per-run recipient cache
>    and a timestamp read-back → **8.5 s**, with the de-duplicating second run at
>    4.7 s.
>
> ### FF-1203 — security
>
> 29 executable checks rather than a document nobody re-runs: IDOR across every
> scoped role, secret hygiene, headers, CORS, injection, upload handling and the
> per-account lockout. **`nodemailer` 6 → 9** was already done in E10 (8
> advisories, one high). One moderate remains: `exceljs` → `uuid < 11.1.1`, a
> bounds check in uuid v3/v5/v6 when a `buf` argument is passed — exceljs uses v4
> and passes no buffer, and npm's only "fix" is a downgrade to exceljs 3.4.0.
> Accepted, and recorded here rather than silently.
>
> ### FF-1204 — performance
>
> `prisma/seed-reference.ts` builds the §7/Q2 dataset (250 vehicles, 40 users,
> 4 000 operations, 1 500 documents). Measured against it:
>
> |                                   | Budget   | Worst measured |
> | --------------------------------- | -------- | -------------- |
> | Dashboard, cold, admin            | 2 000 ms | **50 ms**      |
> | Dashboard, cold, every other role | 2 000 ms | 49 ms          |
> | Dashboard, warm                   | —        | 15 ms          |
> | List endpoints                    | 1 000 ms | 42 ms          |
> | Reports                           | 2 000 ms | 49 ms          |
>
> Two partial indexes were added, each chosen from `EXPLAIN (ANALYZE)` and kept
> only because the planner actually used it — see `prisma/README.md`. No N+1:
> a twenty-fold increase in page size costs 20 ms → 33 ms.
>
> ### FF-1205
>
> `docs/UAT_SCRIPT.md` — five role journeys mapped step by step to PRD
> requirement ids, with severity definitions and exit criteria **agreed before
> testing begins**, which is what the PRD's risk register asks for. The
> Playwright journeys mirror it, so a failed UAT step has an automated
> reproduction.
>
> ### About FF-1208

It has no estimate because nobody can size it before the tests run. What is known:

- it is **not zero** — six weeks of untested code across ten modules will contain defects
- some findings will be **structural**, not local. A wrong assumption in the trigger
  engine or the scope resolvers means reworking callers, not editing one line
- it sits **at the very end**, so anything it uncovers lands with no slack behind it

A reasonable planning placeholder is **20–35% of the build effort** (≈7–12 days),
but that is an industry rule of thumb, not a measurement of this project. Treat
it as a range to re-forecast after FF-1206 and FF-1201 report, which is the first
moment real evidence exists.

---

## E13 — Documentation & handover ✅

| ID      | Task                                                                                             | Est  | P   | PRD     | Dep            | Track |
| ------- | ------------------------------------------------------------------------------------------------ | ---- | --- | ------- | -------------- | ----- |
| FF-1301 | OpenAPI 3.1 generated from the shared Zod schemas, published                                     | 0.75 | P0  | §7      | FF-107, E3–E10 | BE    |
| FF-1302 | Written deliverables: database schema document, administrator guide, user manual                 | 1.5  | P0  | §7      | E3–E10         | FS    |
| FF-1303 | Training session + source code handover + final acceptance sign-off (starts the 90-day warranty) | 0.5  | P0  | §7, §13 | FF-1302        | FS    |

**Subtotal 2.75**

> **Delivered 15 Aug 2026.**
>
> **FF-1301 — OpenAPI 3.1** ([`docs/openapi.json`](./openapi.json), regenerate
> with `npm run docs:api`). Generated from the Zod schemas the API validates
> with, so the document cannot disagree with what the server accepts — and its
> **completeness is checked against the live Express router**, the same
> technique FF-1207 uses, so an endpoint nobody documented fails the build.
> **80 operations, 85 schemas, all 80 registered routes covered.** Constraints
> come through accurately: `plate` carries `maxLength: 20`, `year` carries
> `1900–2027`, because those are read from the schema rather than retyped.
>
> **FF-1302 — three documents, three audiences.**
>
> - [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — the five decisions that shape
>   the schema and why, rather than a table listing that `prisma.schema` already
>   is.
> - [`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md) — includes a "when
>   something looks wrong" section that works through _"nobody is getting
>   emails"_ layer by layer, and a table of the nine things FleetFlow
>   deliberately refuses, each with its reason. Those are the two things that
>   otherwise become support calls.
> - [`USER_MANUAL.md`](./USER_MANUAL.md) — one section per role, matching the
>   five UAT journeys.
>
> **FF-1303 — [`HANDOVER.md`](./HANDOVER.md)**: what is delivered, how to run
> it, what configuration is required, what the client must own, and what is
> _not_ verified. It states plainly that **no email has ever been sent and no
> file has ever been uploaded** — both paths are complete and tested up to the
> integration boundary, and neither has met a real account.
>
> ### Carried-forward items closed
>
> - **`git init` + first commit.** The whole project existed only as working-tree
>   files. Now committed (201 files); `.env` confirmed untracked, `.env.example`
>   tracked. The CI workflow can run.
> - **`package.json#prisma` → `prisma.config.ts`**, ahead of its removal in
>   Prisma 7. One wrinkle worth knowing: Prisma stops auto-loading `.env` as
>   soon as a config file exists, so the file imports `dotenv/config` first —
>   without it every CLI command fails with "Environment variable not found:
>   DATABASE_URL", which looks like a broken database rather than a moved
>   setting.
>
> ### Still open, and deliberately so
>
> - **FF-1105** — Figma design tokens. Applied as CSS variables, so the swap is
>   configuration rather than rebuilding the screens.
> - **Route-level code splitting.** The web bundle is one 617 kB chunk (180 kB
>   compressed). Worth doing; not needed to meet any requirement.
> - **FF-004 / FF-005** — SMTP and Supabase credentials. These gate final
>   acceptance, because PRD §13 requires notification jobs verified in
>   production.
>
> Final gate: lint 0 · typecheck 0 · **249 unit + 913 integration + 31 E2E** ·
> build 0 · OpenAPI regenerated clean.

---

## Totals

| Stage            | Epic                         | Code only            | (was, with inline tests) |
| ---------------- | ---------------------------- | -------------------- | ------------------------ |
| 0. Decisions     | E0 Decisions & access ⛔     | 1.35                 | 1.35                     |
| 1. Foundation    | E1 Foundation ✅             | 5.0                  | 5.0                      |
|                  | E2 Auth & RBAC               | 5.85                 | 6.25                     |
|                  | E11 Frontend foundation      | 3.6                  | 4.75                     |
| 2. Core entities | E3 Users & drivers           | 3.2                  | 4.25                     |
|                  | E4 Vehicles & assignments    | 4.9                  | 6.5                      |
|                  | E6 Documents & storage       | 3.4                  | 4.5                      |
| 3. Operational   | E5 Maintenance               | 5.6                  | 7.5                      |
|                  | E7 Damages                   | 2.8                  | 3.75                     |
| 4. Cross-cutting | E8 Notifications             | 4.5                  | 6.0                      |
|                  | E9 Dashboard                 | 2.1                  | 2.75                     |
|                  | E10 Reports & exports        | 3.6                  | 4.75                     |
| 5. QA            | **E12 Testing & hardening**  | **15.75 + ?**        | 6.25                     |
| 6. Handover      | E13 Documentation & handover | 2.75                 | 2.75                     |
|                  | **Total**                    | **≈ 64.4 + FF-1208** | **≈ 65**                 |

**Read that bottom row carefully.** Deferring the tests saved ≈11 days of build
effort and spent ≈9.5 of them again in E12 at a higher rate. The paper total is
essentially unchanged — but ≈24% of the remaining work is now concentrated in one
late block, and FF-1208 sits outside the estimate entirely.

**P1 tasks total ≈9 person-days** (FF-205, FF-302, FF-402, FF-703, FF-803, FF-805, plus P1 sub-parts of FF-303/502/602). These are the first candidates to cut if scope must shrink — **except FF-801's dedupe constraint, which is one line of SQL and prevents duplicate daily emails to every user**.

---

## Critical path

```
FF-002 ─► FF-103 ─► FF-206 ─► FF-401 ─┬─► FF-501 ─► FF-503 ─┐
                                      ├─► FF-602 ─► FF-603 ─┼─► FF-802 ─► FF-804
                                      └─► FF-701 ───────────┘        ▲
                                                                     │
FF-004 ─► FF-005 ─► FF-203 ───────────────────────────────────────────┘
                                                                     │
                              FF-901 ─► FF-1001 ─► FF-1002 ─► FF-1201 ┘
```

Five tasks to watch, because a slip in any of them fans out widely:

- **FF-103** (schema) — soft delete and the single-assignment index are baked in here; everything downstream depends on it
- **FF-206** (RBAC) — every module endpoint depends on it
- **FF-401** (vehicles) — maintenance, documents and damages all hang off it
- **FF-503** (trigger engine) — highest logical complexity; notifications, dashboard and reports all read its output
- **FF-005** (domain authentication) — not hard, but it is external, often slow, and FF-804 cannot be verified without it
