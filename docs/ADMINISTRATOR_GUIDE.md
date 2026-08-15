# FleetFlow — Administrator guide

**Deliverable:** PRD §7 · **Version:** 1.0 · **Date:** 15 August 2026
**Audience:** the company administrator who owns the installation

---

## Contents

1. [Your first hour](#1-your-first-hour)
2. [Users and roles](#2-users-and-roles)
3. [Settings](#3-settings)
4. [Reference data](#4-reference-data)
5. [Notifications — how the reminders actually work](#5-notifications--how-the-reminders-actually-work)
6. [When something looks wrong](#6-when-something-looks-wrong)
7. [Backups and data retention](#7-backups-and-data-retention)
8. [Things FleetFlow deliberately will not let you do](#8-things-fleetflow-deliberately-will-not-let-you-do)

---

## 1. Your first hour

Do these in order. Each depends on the one before.

1. **Sign in** with the administrator account you were issued and change your password.
2. **Check Settings** (§3). The currency, timezone and notice periods affect
   everything else, and changing them later is fine but means existing reminders
   were calculated with the old values.
3. **Add your document types** (§4) before adding documents, so every document
   gets the right notice period from the start.
4. **Add vehicles**, then **drivers**, then **assign** drivers to vehicles.
5. **Create maintenance plans** — this is what turns FleetFlow from a filing
   cabinet into something that warns you.
6. **Create user accounts** for your team (§2) and let the invitations go out.

---

## 2. Users and roles

**Users** in the sidebar. Administrator only — nobody else can see it.

### The five roles

| Role                      | What they can do                                                                |
| ------------------------- | ------------------------------------------------------------------------------- |
| **Company administrator** | Everything, including user management and configuration                         |
| **Fleet manager**         | Vehicles, drivers, assignments, maintenance, documents. **Not** user management |
| **Mechanic**              | Sees only the jobs assigned to them; updates their status and costs             |
| **Accountant**            | Read-only across the fleet, plus reports and exports                            |
| **Driver**                | Their own vehicle only; reports problems; sees their upcoming maintenance       |

The full cell-by-cell matrix is PRD §2.1. It is enforced on the server for every
request — hiding a menu item is a courtesy, not the security control. A user who
types a URL directly is refused by the API regardless of what the screen shows.

### Creating a user

**Add user**, then name, email and role.

- **Leave the password blank** and FleetFlow emails an invitation; the recipient
  chooses their own password. Prefer this — a password you type is a password
  that travels through a chat message.
- **Resend invitation** is on the row if it does not arrive.

### Changing someone's role

Takes effect on their **very next action**. They do not need to sign out, and
their old permissions stop working immediately — which matters most when you are
taking permissions _away_.

### Deactivate, or delete?

|                  | Deactivate                | Delete                    |
| ---------------- | ------------------------- | ------------------------- |
| Can sign in      | No, immediately           | No, immediately           |
| Their records    | Kept and still attributed | Kept and still attributed |
| Appears in lists | Marked inactive           | Hidden                    |
| Reversible       | Yes, **Activate**         | Not from the interface    |

**Prefer deactivate.** It is the honest answer for somebody who has left: their
maintenance history stays attributed to them, which is what makes "who completed
this job" answerable a year later.

Both take effect the moment you press the button, even if the person is signed in
on another device.

### Drivers are not users

A **driver** is a person who drives a vehicle. A **user** is a login account.
Linking them is optional and most fleets do not bother — a driver only needs an
account if they will use FleetFlow themselves to report problems.

---

## 3. Settings

### General

| Setting      | What it affects                                                     |
| ------------ | ------------------------------------------------------------------- |
| **Timezone** | When the daily reminder job runs, and how due dates are interpreted |
| **Currency** | Every cost figure on screen, in reports and in exports              |
| **Locale**   | Date and number formatting                                          |

FleetFlow is **single-currency.** If you record costs in more than one currency
the totals stop meaning anything — the system will warn in its logs, but it
cannot fix it for you.

### Notification notice periods

| Setting                     | Default   | Meaning                                            |
| --------------------------- | --------- | -------------------------------------------------- |
| **Document notice days**    | 30, 15, 7 | How far ahead an expiring document is announced    |
| **Maintenance notice days** | 14, 7     | How far ahead a due service is announced           |
| **Maintenance notice km**   | 500       | How close to a mileage threshold before announcing |
| **Daily send time**         | 07:00     | When the reminder job runs                         |

Changing these is immediate and needs no redeployment. **A document's own notice
period overrides the default** — set it on the document itself when a particular
policy needs more warning.

### Uploads

Maximum file size (default 20 MB) and accepted types (PDF, JPEG, PNG, WebP,
HEIC — the last because that is what iPhones produce).

**Executables, HTML and SVG are refused and cannot be enabled.** HTML and SVG can
carry script, and a file your staff download is a file your staff trust.

---

## 4. Reference data

### Document types

Insurance, technical inspection, registration, and whatever else you need. Each
carries a **default notice period** used by every document of that type unless
overridden.

Add these before adding documents. A type cannot be removed while documents
still use it.

### Vehicle types

Van, truck, car. Their real value is that **a maintenance plan can target a
type** — "every van, every 15 000 km" — so a new van inherits the schedule the
moment it is added, without anyone remembering to attach it.

---

## 5. Notifications — how the reminders actually work

This is the feature the product exists for, so it is worth understanding.

### The four triggers

| Trigger              | Fires when                                   | Goes to                                                                  |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Maintenance due soon | Inside the notice window, by date or mileage | Fleet managers, the assigned mechanic, the vehicle's driver              |
| Maintenance overdue  | Past its due date or mileage, not completed  | Administrators, fleet managers, the assigned mechanic                    |
| Document expiring    | Inside the document's notice period          | Administrators, fleet managers                                           |
| Inspection due       | A technical inspection approaching expiry    | The above, **and the driver** — they are the one stopped at the roadside |

Accountants receive none. They control spend; they do not chase inspections.

### Once per day, per rule, per record

If a document is 30 days from expiry for a fortnight, the reminder goes out
**once**, not fourteen times. This is enforced by the database, not by
bookkeeping, which means it holds even if the job is run twice by hand or twice
by accident.

**You can safely press "Check now" as often as you like.** It will not re-send
anything.

### Two channels

Every reminder appears **in the app** (the bell) and is **emailed**. The in-app
notification is written first and does not depend on the email succeeding — so a
mail outage degrades the feature rather than silencing it.

---

## 6. When something looks wrong

### "Nobody is getting emails"

Work through this in order; each step rules out a layer.

1. **Is anything actually due?** Open the dashboard. If the upcoming and overdue
   counters are zero, silence is correct.
2. **Are notifications appearing in the app?** If yes, the rules are working and
   the problem is delivery only. If no, the rules found nothing.
3. **Check delivery health.** The API reports queued, sent and failed counts and
   the oldest queued timestamp.
   - **Queued is growing, failed is zero** → SMTP is not configured, or the
     worker is not running. Queued mail is _held_, not discarded, so it will go
     out once the problem is fixed.
   - **Failed is climbing** → SMTP is rejecting messages. Check the credentials
     and the sending domain's DNS records.
4. **Is the worker process running?** The reminder job runs in a separate
   process from the API (`npm run start:worker`). The web application works
   perfectly without it — and no reminders are sent.
5. **Check the spam folder.** If reminders land in spam the feature fails
   silently, which is the worst way for it to fail. The sending domain needs its
   authentication DNS records in place.

### "A vehicle disappeared"

Almost always archived. Vehicle list → include archived. Archiving removes a
vehicle from operational lists **while keeping all of its history and costs in
reports** — that is what it is for.

### "The dashboard number does not match the list"

It should — every counter opens the exact rows it counted. If they ever differ,
that is a defect worth reporting, with the two numbers and what you clicked.

### "Somebody cannot see something they should"

Check their role against §2. If the role is right and the screen is still wrong,
note the **request id** shown on the error and report it — it points straight at
the matching line in the server log.

### Getting a useful bug report

Every error screen shows a **request id**. Including it turns "it broke" into a
single log line. Ask your team to copy it.

---

## 7. Backups and data retention

**FleetFlow does not manage its own backups.** The database is the whole product;
losing it loses everything.

- Configure automated backups on your PostgreSQL host.
- **Test a restore before go-live.** A backup nobody has restored is a hypothesis.
- Uploaded files live in object storage, separately. They need their own backup.
- Retention policy is a decision the PRD leaves open (§12); agree it and set it
  on the host.

---

## 8. Things FleetFlow deliberately will not let you do

Not bugs. Each prevents an unrecoverable state.

| Refused                                                   | Why                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Deactivate or delete **your own** account                 | You would lock yourself out of the only screen that could undo it                   |
| Remove the **last active administrator**                  | Nobody could manage users, and there is no way back without database access         |
| Delete a **driver who still holds a vehicle**             | The assignment would point at nobody                                                |
| Reopen **completed** maintenance                          | Corrections are an edit of the record, so the completion history stays honest       |
| Reopen a **resolved or rejected** damage report           | File a new report instead — the decision stays on the record                        |
| Set a damage to **linked** by hand                        | That status claims a maintenance job exists; only converting the report creates one |
| Record an odometer reading **lower** than the current one | It would silently reset every mileage-triggered plan on the vehicle                 |
| Assign **two drivers** to one vehicle at once             | Client decision Q5. Reassigning closes the previous assignment automatically        |
| Upload an **executable, HTML or SVG** file                | They can carry script, and staff trust files they download from FleetFlow           |
