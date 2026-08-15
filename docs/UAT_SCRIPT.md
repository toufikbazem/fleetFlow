# FleetFlow — User Acceptance Test script

**Status:** draft for client agreement · **Version:** 1.0 · **Date:** 15 August 2026

---

## Why this document exists before QA, not after

The PRD's risk register names "undefined acceptance criteria for UAT" as a risk
whose impact is _disputed sign-off and delayed final payment_, and its mitigation
as _agree the UAT test script before development ends_. This is that script.

**It needs to be agreed before testing starts.** A script written after the
testing has begun records what the software does; a script agreed beforehand
records what the client asked for. Only the second one can settle a
disagreement, and settling disagreements is what the final payment milestone
depends on.

Every step below maps to a numbered requirement in the PRD. If a step here does
not match your expectation, that is a specification issue to resolve now —
before it becomes a defect report during acceptance.

---

## 1. How to use this script

|                        |                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who runs it**        | A named client tester per role. Five roles, so ideally five people; one person may run several sessions.                                     |
| **Where**              | The staging environment. Not production.                                                                                                     |
| **Data**               | The demo dataset. Do not use real fleet data — some steps delete records.                                                                    |
| **How long**           | About 3 hours across all five journeys, plus 1 hour for the cross-cutting checks.                                                            |
| **Recording a result** | Tick **Pass** or **Fail**. A failure needs the step number, what you expected, what happened, and the `Request ID` if the screen showed one. |

### Severity, agreed in advance

Agreeing severity before the results arrive is what stops the conversation
becoming an argument about whose bug is worse.

| Severity         | Meaning                                                                                  | Effect on go-live                                       |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **S1 — Blocker** | A P0 requirement cannot be completed at all, or data is lost or shown to the wrong role. | Blocks go-live.                                         |
| **S2 — Major**   | A P0 requirement works but with a wrong result, or a workaround is needed each time.     | Blocks go-live unless the client accepts it in writing. |
| **S3 — Minor**   | Cosmetic, or a P1/P2 behaviour.                                                          | Fixed in the warranty period; does not block.           |
| **S4 — Change**  | Works as specified, but the specification is not what was wanted.                        | A change request, quoted separately (proposal §3.2).    |

### Accounts

| Role                  | Account        | Journey |
| --------------------- | -------------- | ------- |
| Company administrator | _to be issued_ | A       |
| Fleet manager         | _to be issued_ | B       |
| Mechanic              | _to be issued_ | C       |
| Driver                | _to be issued_ | D       |
| Accountant            | _to be issued_ | E       |

---

## 2. Entry criteria

Testing does not begin until all of these are true. Starting earlier produces
defect reports about an environment rather than about the product.

- [ ] All P0 requirements are deployed to staging.
- [ ] SMTP is configured and a test email has been received (**FF-004/FF-005** — see §7).
- [ ] Supabase storage is configured and a file upload has succeeded.
- [ ] The demo dataset is loaded.
- [ ] Five test accounts are issued and each tester has signed in once.
- [ ] This script is agreed in writing by the client.

---

## 3. Journey A — Company administrator

> Sets the installation up and controls who can reach it.

| #   | Step                                                               | Expected result                                                                                    | PRD            | Pass |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------- | ---- |
| A1  | Sign in with the administrator account.                            | The dashboard opens. The sidebar shows every module, including **Users**.                          | AUTH-01        | ☐    |
| A2  | Sign in again with a deliberately wrong password.                  | Refused. The message does **not** say whether the account exists.                                  | AUTH-01        | ☐    |
| A3  | Repeat a wrong password about ten times.                           | The account is temporarily locked. A colleague on the same network can still sign in.              | AUTH-05        | ☐    |
| A4  | Use **Forgot password**, then the emailed link.                    | The email arrives within a minute. The link sets a new password.                                   | AUTH-02        | ☐    |
| A5  | Open the same reset link a second time.                            | Refused — a reset link is single use.                                                              | AUTH-02        | ☐    |
| A6  | Create a user with the **Mechanic** role and no password.          | Created. An invitation email arrives; the recipient chooses their own password.                    | USR-01, USR-04 | ☐    |
| A7  | Create a second user with an email that already exists.            | Refused, naming the email field.                                                                   | USR-01         | ☐    |
| A8  | Change the mechanic you created to **Accountant**.                 | Saved. On that user's _next_ action, their menu and permissions have changed — no sign-out needed. | USR-02         | ☐    |
| A9  | Deactivate that user while they are signed in.                     | Their next action signs them out immediately.                                                      | USR-03         | ☐    |
| A10 | Find a maintenance job the deactivated user recorded.              | Still present, still showing their name.                                                           | USR-03         | ☐    |
| A11 | Try to deactivate your own account.                                | Refused — you cannot lock yourself out.                                                            | —              | ☐    |
| A12 | Add a document type, e.g. "Road tax", with a 45-day notice period. | Available when adding a document.                                                                  | DOC-06         | ☐    |
| A13 | Add a vehicle: plate, make, model, year, type, mileage.            | Created and listed.                                                                                | VEH-01         | ☐    |
| A14 | Add a second vehicle with the same plate.                          | Refused.                                                                                           | VEH-01         | ☐    |
| A15 | Archive a vehicle.                                                 | It leaves the vehicle list. Its maintenance history and costs remain in reports.                   | VEH-06         | ☐    |

---

## 4. Journey B — Fleet manager

> Keeps the fleet running and compliant. The longest journey, and the one that
> exercises the trigger engine.

| #   | Step                                                                          | Expected result                                                                                                       | PRD                    | Pass |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---- |
| B1  | Sign in as the fleet manager.                                                 | The dashboard opens. There is **no Users** entry in the sidebar.                                                      | AUTH-06                | ☐    |
| B2  | Add a driver, with no login account.                                          | Created. A login account is optional.                                                                                 | DRV-01, DRV-04         | ☐    |
| B3  | Assign a vehicle to that driver from today.                                   | The vehicle shows the driver.                                                                                         | DRV-02                 | ☐    |
| B4  | Assign the _same vehicle_ to a different driver from today.                   | The first assignment is closed automatically; the second is open. **Both appear in the history.**                     | DRV-03, Q5             | ☐    |
| B5  | Open the vehicle's detail page.                                               | Driver history, maintenance schedule, maintenance history and document status all appear **without navigating away**. | VEH-02, VEH-03         | ☐    |
| B6  | Create a maintenance plan on a vehicle type: every 180 days, 14 days' notice. | Saved.                                                                                                                | MNT-04                 | ☐    |
| B7  | Create a mileage plan: every 15 000 km, 500 km notice.                        | Saved.                                                                                                                | MNT-02, MNT-04         | ☐    |
| B8  | Record a mileage reading that crosses the 15 000 km threshold.                | An upcoming maintenance task appears for that vehicle.                                                                | VEH-05, MNT-02         | ☐    |
| B9  | Record a mileage reading **lower** than the current one.                      | Refused — an odometer does not run backwards.                                                                         | VEH-05                 | ☐    |
| B10 | Schedule a job with a due date in the past.                                   | It is shown as **overdue** and appears on the dashboard.                                                              | MNT-06                 | ☐    |
| B11 | Assign that job to a mechanic.                                                | The mechanic's name appears on it.                                                                                    | MNT-07                 | ☐    |
| B12 | Upload an invoice PDF against a maintenance job.                              | Uploads, then downloads again from the vehicle's history.                                                             | MNT-03                 | ☐    |
| B13 | Upload a `.exe` file.                                                         | Refused.                                                                                                              | §5 security            | ☐    |
| B14 | Add a document with an expiry 10 days away and a 30-day notice.               | Shown as **expiring soon**.                                                                                           | DOC-01, DOC-03, DOC-05 | ☐    |
| B15 | Add a document that expired yesterday.                                        | Shown as **expired**.                                                                                                 | DOC-05                 | ☐    |
| B16 | Add a document expiring in a year.                                            | Shown as **valid**.                                                                                                   | DOC-05                 | ☐    |
| B17 | Open the damage queue.                                                        | The driver's report from journey D is listed.                                                                         | DMG-03                 | ☐    |
| B18 | Convert that report into a maintenance job.                                   | A job is created. The job shows the damage; the damage shows the job.                                                 | DMG-02                 | ☐    |
| B19 | Try to convert the same report again.                                         | Refused — it is already linked.                                                                                       | DMG-02                 | ☐    |
| B20 | Click each dashboard counter in turn.                                         | Each opens a list, and **the number of rows matches the counter**.                                                    | DSH acceptance         | ☐    |

---

## 5. Journey C — Mechanic

> Sees what to work on and records what was done.

| #   | Step                                                  | Expected result                                                                  | PRD            | Pass |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- | ---- |
| C1  | Sign in as the mechanic.                              | The landing screen shows the jobs assigned to you.                               | DSH            | ☐    |
| C2  | Look at the maintenance list.                         | **Only jobs assigned to you.** Other mechanics' work is not listed.              | AUTH-06        | ☐    |
| C3  | Check the sidebar.                                    | No **Drivers**, no **Users**, no **Reports**.                                    | AUTH-06        | ☐    |
| C4  | Open one of your jobs and set it to **In progress**.  | Saved.                                                                           | MNT-06         | ☐    |
| C5  | Complete it, entering parts 310.50 and labour 180.00. | Saved. The total shows **490.50** — you do not type it.                          | MNT-05, MNT-06 | ☐    |
| C6  | Try to reopen the completed job.                      | Refused — completed work is final. Corrections are an edit, not a status change. | MNT-06         | ☐    |
| C7  | Attach a photo to a job.                              | Uploads and can be viewed again.                                                 | MNT-03         | ☐    |
| C8  | Open the notification bell.                           | Reminders about **your** jobs only.                                              | NTF-06         | ☐    |

---

## 6. Journey D — Driver

> Uses one vehicle and reports problems. **Run this journey on a phone** — it is
> the most mobile-critical flow in the product.

| #   | Step                                            | Expected result                                                | PRD            | Pass |
| --- | ----------------------------------------------- | -------------------------------------------------------------- | -------------- | ---- |
| D1  | Sign in as the driver on a phone.               | The screen is usable without horizontal scrolling.             | §5 UI          | ☐    |
| D2  | Look at the vehicle list.                       | **Exactly one vehicle** — yours.                               | AUTH-06        | ☐    |
| D3  | Look at upcoming maintenance.                   | Only your vehicle's.                                           | MNT            | ☐    |
| D4  | Report a problem: description, severity, photo. | Submitted. It appears in the fleet manager's queue (step B17). | DMG-03, DMG-04 | ☐    |
| D5  | Try to report a problem on another vehicle.     | Not offered, and refused if attempted.                         | AUTH-06        | ☐    |
| D6  | Open the notification bell.                     | Only reminders for you — including your vehicle's inspection.  | NTF-03, NTF-06 | ☐    |
| D7  | Mark a notification as read.                    | The unread badge decreases.                                    | NTF-06         | ☐    |

---

## 7. Journey E — Accountant

> Controls fleet spend. This journey decides whether the cost figures can be
> trusted.

| #   | Step                                                                                 | Expected result                                                                       | PRD               | Pass |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------- | ---- |
| E1  | Sign in as the accountant.                                                           | The dashboard shows the monthly maintenance cost summary.                             | DSH-08            | ☐    |
| E2  | Check the sidebar.                                                                   | **Reports** present; no **Users**. Vehicles and maintenance are read-only.            | AUTH-06           | ☐    |
| E3  | Try to edit a maintenance job.                                                       | Not offered.                                                                          | AUTH-06           | ☐    |
| E4  | Open **Reports** and run _maintenance cost per vehicle_.                             | The table lists vehicles with their totals.                                           | RPT-02            | ☐    |
| E5  | Run _maintenance cost by period_.                                                    | Grouped by month.                                                                     | RPT-03            | ☐    |
| E6  | **Compare the report total for the last 12 months with the dashboard cost summary.** | **The two figures are identical.**                                                    | RPT-06 acceptance | ☐    |
| E7  | Filter a report by date range and by vehicle.                                        | The table narrows accordingly.                                                        | RPT-07            | ☐    |
| E8  | Export that filtered view to **CSV**, **Excel** and **PDF**.                         | Three files download.                                                                 | RPT-06            | ☐    |
| E9  | Open the Excel export.                                                               | Same rows as the screen. Costs are **numbers** — select a column and Excel sums them. | RPT-06            | ☐    |
| E10 | Compare the exported total with the on-screen total.                                 | Identical.                                                                            | RPT-06 acceptance | ☐    |
| E11 | Open the PDF export.                                                                 | Readable, with the FleetFlow header, page numbers, and the filters stated.            | RPT-06            | ☐    |
| E12 | Run _vehicle maintenance history_ covering an **archived** vehicle's period.         | Its past costs still appear — archiving does not erase history.                       | VEH-06, RPT-01    | ☐    |
| E13 | Run _driver assignment history_.                                                     | Every assignment with its dates, including closed ones.                               | RPT-04            | ☐    |
| E14 | Run _expiring documents_.                                                            | Documents with their status and days remaining.                                       | RPT-05            | ☐    |

---

## 8. Cross-cutting checks

Run these once, with whichever accounts they name. They cover the requirements
that are not one role's journey.

### 8.1 Notifications — NTF

| #   | Step                                                             | Expected result                                                                                           | PRD            | Pass |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- | ---- |
| X1  | Wait for the daily send time (or ask the vendor to run the job). | Emails arrive for maintenance due, documents expiring, inspections due and overdue maintenance.           | NTF-01…05      | ☐    |
| X2  | **Ask the vendor to run the job a second time the same day.**    | **No second email and no duplicate in the app.**                                                          | **NTF-07**     | ☐    |
| X3  | Check that each email's link opens the right record.             | It does, after signing in.                                                                                | NTF-06         | ☐    |
| X4  | Check who received what.                                         | Managers get fleet-wide reminders; a driver gets their own vehicle's inspection; an accountant gets none. | NTF acceptance | ☐    |
| X5  | Check the spam folder.                                           | Nothing there.                                                                                            | Risk §11       | ☐    |

### 8.2 Permissions — AUTH-06

The permission matrix is PRD §2.1. Confirm each cell by looking at the sidebar
and at what each screen offers.

| #   | Step                                                                 | Expected result                            | Pass |
| --- | -------------------------------------------------------------------- | ------------------------------------------ | ---- |
| X6  | As each role in turn, list which modules are visible.                | Matches PRD §2.1 exactly.                  | ☐    |
| X7  | While signed in as a driver, paste a URL for another vehicle's page. | Refused — the address bar is not a way in. | ☐    |
| X8  | While signed in as a mechanic, paste the reports URL.                | Refused.                                   | ☐    |

### 8.3 Non-functional

| #   | Step                                              | Expected result          | PRD              | Pass |
| --- | ------------------------------------------------- | ------------------------ | ---------------- | ---- |
| X9  | Load the dashboard on the full dataset.           | Under 2 seconds.         | DSH acceptance   | ☐    |
| X10 | Open the app in Chrome, Firefox, Edge and Safari. | Works in all four.       | §5 compatibility | ☐    |
| X11 | Use the app at 360 px width.                      | Usable; nothing clipped. | §5 UI            | ☐    |
| X12 | Confirm the address bar shows a padlock.          | HTTPS active.            | §5 security      | ☐    |

---

## 9. Exit criteria — what "signed off" means

Testing is complete when **all** of these hold. Agreeing this list now is what
turns sign-off into a checklist rather than a negotiation.

- [ ] Every step in journeys A–E has been executed and recorded.
- [ ] All cross-cutting checks have been executed and recorded.
- [ ] **Zero open S1 defects.**
- [ ] **Zero open S2 defects**, or each remaining one accepted in writing by the client.
- [ ] S3 defects are logged and scheduled within the 90-day warranty.
- [ ] S4 items are logged as change requests, quoted separately, and **explicitly excluded from this sign-off**.
- [ ] The client's named decision-maker has signed the results.

---

## 10. Result log

| Step | Severity | What was expected | What happened | Request ID | Status |
| ---- | -------- | ----------------- | ------------- | ---------- | ------ |
|      |          |                   |               |            |        |

---

## 11. Known limitations at the time of writing

Declared up front rather than discovered during testing, because a known
limitation reported as a defect costs both sides a triage cycle.

| Item                       | Detail                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email and file storage** | SMTP (FF-004/FF-005) and Supabase storage credentials are supplied by the client. Until both exist, journey B12–B13 and every step in §8.1 cannot be executed. **These are entry criteria, not defects.** |
| **Design tokens**          | The interface uses a neutral theme until the Figma palette, logo and typography are signed off (FF-1105). Visual styling is not in scope for defect reports before then.                                  |
| **Deployment**             | Hosting and deployment were removed from scope at the client's direction. Staging is provided for UAT only.                                                                                               |
| **Language**               | English only (Q7). No translation or right-to-left support.                                                                                                                                               |
| **Currency**               | Single currency, set in Settings (Q8). Mixed-currency fleets are not supported.                                                                                                                           |
| **Data migration**         | Not a deliverable (PRD §10). Existing spreadsheets are not imported.                                                                                                                                      |
