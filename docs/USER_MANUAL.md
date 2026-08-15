# FleetFlow — User manual

**Deliverable:** PRD §7 · **Version:** 1.0 · **Date:** 15 August 2026
**Audience:** everybody who uses FleetFlow

---

## Find your role

FleetFlow shows you a different application depending on what you do. Read the
section for your role; the rest will not apply to you.

- [Everybody — signing in and notifications](#everybody)
- [Fleet manager](#fleet-manager)
- [Mechanic](#mechanic)
- [Driver](#driver)
- [Accountant](#accountant)

Administrators have their own, longer guide:
[`ADMINISTRATOR_GUIDE.md`](./ADMINISTRATOR_GUIDE.md).

---

## Everybody

### Signing in

Your administrator creates your account and FleetFlow emails you an invitation.
Follow the link and choose your own password — nobody else ever knows it.

**Forgotten it?** Use _Forgot password_ on the sign-in screen. The link works
once and expires; request another if it lapses.

If you get the password wrong several times your account locks for a short
while. Colleagues on the same network are unaffected.

### The bell

Every role has one, top right. The number is how many reminders you have not
read.

Reminders are about **your** work — your vehicle, your jobs, your fleet — and
each one is a link to the record it is about, so you can act without hunting for
it. Opening a reminder marks it read.

You also get these by email. Same content, so you can work from whichever you
check.

### Using FleetFlow on a phone

It works on a phone. Drivers in particular are expected to use it that way — the
"report a problem" form is designed to be filled in at the roadside.

---

## Fleet manager

You keep the fleet running and compliant. Most of FleetFlow is yours; user
accounts are not.

### Adding a vehicle

**Vehicles → Add vehicle.** Plate, make and model are required; everything else
can wait. Set the **current odometer** if you know it — it is what mileage-based
servicing counts from.

### Assigning a driver

Open the vehicle → assign a driver.

**One driver holds a vehicle at a time.** Handing it to somebody else closes the
previous assignment automatically and keeps it in the history — so "who had this
van in March" stays answerable.

### The vehicle page

Everything about one vehicle without going anywhere else: driver history,
upcoming maintenance, maintenance history, documents, recent odometer readings
and the total spent on it.

### Recording mileage

Open the vehicle → record a reading.

**This is what makes mileage-based servicing work.** A van on a 15 000 km plan
only becomes due when somebody tells FleetFlow the odometer has moved.

A reading lower than the current one is refused — an odometer does not run
backwards, and accepting one would silently reset the vehicle's schedule.

### Maintenance plans — the part worth your time

A **plan** is a rule. A **job** is the work.

Plans → new plan. Choose:

- **by date** — every 180 days
- **by mileage** — every 15 000 km
- **both** — whichever comes first

Point it at **one vehicle** or at **a whole vehicle type**. Targeting the type is
usually right: a new van then inherits the schedule the moment it is added,
without anyone remembering.

FleetFlow creates the jobs and warns you before they are due. **This is the
difference between FleetFlow and a spreadsheet.**

### Documents

**Documents → add.** Type, expiry date, and optionally a scan.

Each shows as **valid**, **expiring soon** or **expired**, recalculated every
time you look — never stale. The notice period comes from the document type; you
can override it for a document that needs more warning.

You are reminded before expiry. That is the point.

### Damage reports

Drivers report problems and they land in your queue.

Read the report, then either:

- **Raise a maintenance job** from it — the job and the report stay linked, so
  each shows the other; or
- **Reject** it, which keeps it on the record so the driver can see it was seen.

A report can be converted once.

### The dashboard

Eight numbers. **Every one is clickable and opens exactly the records it
counted** — if a counter says seven, the list has seven rows.

---

## Mechanic

FleetFlow shows you your work and nothing else.

### Your jobs

You land on **My jobs** — the jobs assigned to you. Other mechanics' work is not
listed; there is nothing to filter out.

Overdue first, then soonest due. That is the order to work through.

### Doing a job

1. **Start it.** Set it to _in progress_ so the office can see it is underway.
2. **Do the work.**
3. **Complete it**, entering **parts** and **labour**.

FleetFlow adds the total. You never type it, and it can never disagree with the
components.

**Completing a job is final.** If you got something wrong, edit the record —
status does not go backwards, so the completion history stays honest.

### Attaching an invoice or a photo

Open the job → attach. PDFs and photos. They stay with the vehicle's maintenance
history, so the invoice is still findable a year later.

### Your bell

Reminders about **your** jobs — coming due, or overdue.

---

## Driver

FleetFlow is small for you on purpose: your vehicle, and a way to report
problems.

### Your vehicle

**Vehicles** shows exactly one — yours. If it shows nothing, no vehicle is
currently assigned to you; ask your fleet manager.

You can see its details, its upcoming maintenance and its documents. You cannot
change them.

### Reporting a problem

This is the important one, and it works on a phone.

**Damages → Report a problem.**

1. Describe what happened — a sentence or two of detail is genuinely useful.
2. Say how bad it is.
3. **Add photos.** A photo is worth a paragraph.

Submit. It goes straight to your fleet manager's queue. You will see it in your
own list with its status as they work through it.

You can only report on the vehicle you are driving.

### Upcoming maintenance

Your vehicle's scheduled work, so a booking is not a surprise.

### Your bell

Reminders about your vehicle — including its **inspection**, because you are the
one who gets stopped if it has lapsed.

---

## Accountant

You control spend. You can see everything and change nothing.

### The dashboard

Its own section is the **monthly maintenance cost summary** — twelve months at a
glance, with this month's figure called out.

### Reports

**Reports.** Five of them:

| Report                       | Answers                                    |
| ---------------------------- | ------------------------------------------ |
| Vehicle maintenance history  | What was done, when, by whom, for how much |
| Maintenance cost per vehicle | Which vehicles cost the most               |
| Maintenance cost by period   | What we spent each month                   |
| Driver assignment history    | Who had which vehicle, and when            |
| Expiring documents           | What is about to lapse                     |

Filter by **date range** and by **vehicle**. The filter bar only offers the
filters a given report actually uses.

The total at the bottom covers the **whole filtered set, not the page you are
looking at.**

### Exports

Three buttons: **CSV**, **Excel**, **PDF**.

All three contain the same rows as the screen, and the whole result set rather
than the visible page.

- **Excel and CSV carry real numbers** — select a column and your spreadsheet
  sums it. They are for working with.
- **PDF is formatted for reading**, with the filters and page numbers in the
  footer. It is for sending and filing.

**Exported figures reconcile with the dashboard for the same period.** If they
ever do not, that is worth reporting.

### Archived vehicles still count

A van sold in March does not un-spend what was serviced in February. Historical
reports include vehicles that have since left the fleet, which is why last
quarter's figure does not change when you tidy the fleet list.

---

## Getting help

Every error screen shows a **request id**. Copy it into your report — it points
your administrator straight at the matching line in the log, and turns "it broke"
into something diagnosable.
