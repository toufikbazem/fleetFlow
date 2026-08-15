# FleetFlow — Handover

**Deliverable:** PRD §7, §13 · **Version:** 1.0 · **Date:** 15 August 2026
**From:** NovaTech Solution · **To:** FleetFlow

---

## 1. What is being handed over

| Deliverable                                     | Where                                                                                    | Status                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Complete web application, including source code | this repository                                                                          | ✅                                                   |
| Database schema document                        | [`docs/DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)                                        | ✅                                                   |
| API documentation                               | [`docs/openapi.json`](./openapi.json) — OpenAPI 3.1                                      | ✅                                                   |
| Administrator guide                             | [`docs/ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md)                                | ✅                                                   |
| User manual                                     | [`docs/USER_MANUAL.md`](./USER_MANUAL.md)                                                | ✅                                                   |
| UAT script                                      | [`docs/UAT_SCRIPT.md`](./UAT_SCRIPT.md)                                                  | ✅ ready for sign-off                                |
| Implementation plan and task breakdown          | [`docs/IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md), [`docs/TASKS.md`](./TASKS.md) | ✅                                                   |
| Training session                                | live                                                                                     | scheduled                                            |
| Deployment guide                                | —                                                                                        | **out of scope** (removed at the client's direction) |
| Logo, colour palette, UI mockups                | —                                                                                        | **client-supplied**, not yet received (FF-1105)      |
| One production deployment                       | —                                                                                        | **out of scope** (removed at the client's direction) |

**Ownership of all deliverables transfers on receipt of the final payment**
(proposal §2.5).

---

## 2. Running it

```bash
npm install
cp .env.example .env          # then fill in the values in §3
npm run db:up                 # Postgres + Redis via Docker
npm run db:deploy             # apply migrations
npm run db:seed               # demo data
npm run dev                   # API, web and the shared package together
```

The web application is then on `http://localhost:5173` and the API on
`http://localhost:4000`.

**The reminder job runs in a separate process**, and this is the single most
important operational fact in this document:

```bash
npm run start:worker
```

FleetFlow works perfectly without it — and sends no reminders. If the worker is
not running, the product's core value proposition is silently absent. Whatever
runs the API in your environment must also run the worker.

### Everything else

| Command                    | Does                                             |
| -------------------------- | ------------------------------------------------ |
| `npm run verify`           | typecheck, lint, format check, unit tests, build |
| `npm test`                 | 249 unit tests                                   |
| `npm run test:integration` | 913 integration tests (needs Postgres and Redis) |
| `npm run test:e2e`         | 31 browser journeys (needs the app running)      |
| `npm run docs:api`         | regenerate the OpenAPI document                  |
| `npm run db:studio`        | browse the database                              |

---

## 3. Configuration

All configuration is environment variables. `.env.example` documents every one;
the API refuses to start if a required value is missing or malformed, and says
which — a misconfigured deployment fails at boot rather than at the first
request.

### Required — the API will not start without these

| Variable       | Notes                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string                                                    |
| `REDIS_URL`    | Sessions, rate limiting, dashboard cache                                        |
| `JWT_SECRET`   | **At least 32 characters, randomly generated.** Changing it signs everybody out |
| `APP_URL`      | The address users reach FleetFlow at. Used in email links                       |

### Feature configuration — grouped, and all-or-nothing

| Group              | Variables                                                           | If absent                                                                |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Object storage** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`      | Uploads answer 503 with a clear message. Everything else works           |
| **Email**          | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Reminders appear in the app; email is **held in a queue, not discarded** |

**A partially configured group is always fatal**, in every environment. Three of
five SMTP settings is not a working mail configuration, and starting anyway would
mean discovering it when the first reminder failed to send. In production both
groups are required outright.

---

## 4. Accounts you must own before go-live

These are yours, not ours (PRD §10), and two of them are **currently
outstanding**:

| Account                                          | For                                     | Status                  |
| ------------------------------------------------ | --------------------------------------- | ----------------------- |
| PostgreSQL host                                  | The database                            | client                  |
| Redis                                            | Cache and sessions                      | client                  |
| **Supabase Storage**                             | Document scans, invoices, damage photos | ⚠️ **not yet supplied** |
| **SMTP provider + authenticated sending domain** | Reminder and invitation email           | ⚠️ **not yet supplied** |

### What is not yet verified, and why

Both integrations are **built and complete**, but neither has run against a real
account. Specifically:

- **No email has ever been sent.** The queue, the retry policy, the delivery log
  and the templates are all exercised by tests, and the code correctly _holds_
  mail while SMTP is absent. What is unproven is that your provider accepts it,
  and that it does not land in spam — which the PRD's own risk register calls
  the way this product fails silently.
- **No file has ever been uploaded.** The signed-URL flow, the type and size
  validation, and the post-upload verification are all in place and tested to
  the point where they hand off to Supabase.

**These are the first things to exercise once the accounts exist.** They are
listed as _entry criteria_ in the UAT script, not as defects — testing cannot
begin without them, and the launch checklist (PRD §13) requires notification
jobs verified in production.

---

## 5. How the code is organised

```
apps/api        Express + Prisma. routes → services → repositories
apps/web        React + Vite
packages/shared Zod schemas, types and the permission matrix — imported by both
prisma          Schema, migrations, seeds
docs            Everything in §1
e2e             Browser journeys
scripts         OpenAPI generator, maintenance scripts
```

### Three things to understand before changing anything

**1. `packages/shared` is the contract.** Every request and response shape, and
the permission matrix, live there and are imported by both applications. A
breaking change fails `tsc` on both sides immediately, which is what has kept ten
modules from drifting apart. Change contracts there, never in one app.

**2. The database holds the invariants, not the application code.** One open
assignment per vehicle, costs that add up, one notification per rule per day —
all constraints. A rule enforced only in a service is a rule that a future code
path will forget, and the symptom appears long after the omission. Read
[`prisma/README.md`](../prisma/README.md) before touching migrations.

**3. Authorisation is two questions, not one.** `can(role, module, action)`
answers _may this role do this?_; the scope it returns answers _to which rows?_
Both are enforced server-side on every request. The interface hides what a role
cannot reach, but that is a courtesy — the API decides independently, and a user
typing a URL is refused regardless.

---

## 6. What the tests cover, and what they do not

**1,193 automated checks**: 249 unit · 913 integration · 31 browser journeys.

Worth knowing about two of them:

- **The permission matrix is verified against every shipped endpoint.** The route
  list is read out of the live Express router, so an endpoint nobody classified
  fails the build. All 80 are covered, across all five roles.
- **The OpenAPI document is generated from the same schemas the API validates
  with**, and its completeness is checked the same way. It cannot drift.

**Not covered, and honestly so:**

- Real SMTP delivery and real file upload (§4).
- Visual design, pending the Figma sign-off (FF-1105).
- Anything in the PRD's out-of-scope list (§3.2) — GPS, fuel, routing, native
  mobile, SMS/WhatsApp, AI analytics, multi-company.

---

## 7. Known limitations

Declared rather than discovered.

| Limitation                      | Detail                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Single currency**             | Set in Settings. Mixed-currency fleets would produce meaningless totals; the system warns in its logs but cannot fix it                                                        |
| **English only**                | Client decision Q7. No translation, no right-to-left                                                                                                                           |
| **One driver per vehicle**      | Client decision Q5, enforced by the database. Shift-based sharing would need a schema change                                                                                   |
| **Neutral visual theme**        | Until the Figma palette, logo and typography arrive (FF-1105). Applied as CSS variables, so swapping them is a configuration change, not a rebuild of the screens              |
| **No data migration**           | Not a deliverable (PRD §10). Existing spreadsheets are not imported                                                                                                            |
| **Bundle size**                 | The web bundle is ~617 kB (180 kB compressed) in one chunk. Route-level code splitting is the obvious improvement and was not needed to meet any requirement                   |
| **`exceljs` → `uuid` advisory** | A moderate advisory that does not apply — exceljs uses uuid v4 and passes no buffer — and whose only "fix" is a downgrade. Accepted deliberately; revisit when exceljs updates |

---

## 8. Before go-live

The PRD's launch checklist (§13), with what is done and what is yours:

- [x] All P0 requirements demonstrated
- [ ] **UAT script executed and signed off** — script ready, needs your testers
- [x] Security review completed (auth, authorisation, upload handling, transport)
- [ ] **Production deployed with SSL** — deployment removed from our scope
- [ ] **Notification jobs verified in production** — blocked on SMTP (§4)
- [ ] **Backups configured and a restore tested** — yours; a backup nobody has
      restored is a hypothesis
- [x] Documentation delivered
- [ ] Training session delivered
- [x] Source code handed over
- [ ] **Final acceptance signed** — starts the 90-day warranty

### Also worth doing early

- **Put this repository under version control and into your CI.** A GitHub
  Actions workflow is included and will run the full gate on every push.
- **Rotate `JWT_SECRET`** for production. Never reuse the development value.
- **Run the worker** (§2). This is the one that goes wrong quietly.

---

## 9. Warranty

90 days from final acceptance, covering bug fixes, functional defects, security
vulnerabilities and supported-browser compatibility.

**Not covered:** new features, changes to approved requirements, third-party
outages, and anything in the out-of-scope list (proposal §3.2, §6).

When reporting a defect, include the **request id** from the error screen. It
points directly at the matching line in the server log and is the difference
between a diagnosis and a guess.
