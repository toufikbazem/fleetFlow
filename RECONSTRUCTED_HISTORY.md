# Reconstructed Git history

**This repository's history is a reconstruction, not a recovery.**

FleetFlow was developed with significant assistance from AI coding tools and was
never placed under version control while it was being built. No `.git` directory,
no reflog, no stashes, no remote — nothing of the original commit history exists,
because it never existed.

The 37 commits preceding this one were created in a single pass on **6 September
2026** from the final state of the source tree. They are a considered
reconstruction of the order in which the work was done. They are not, and cannot
be, a record of it.

Every one of them carries a `Reconstructed-History: true` trailer, so this fact
travels with the commits rather than living only in this file.

---

## What the reconstruction was derived from

Three independent sources of evidence, which agree with each other:

1. **The planning documents.** [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
   and [`docs/TASKS.md`](docs/TASKS.md) define 13 epics and 58 tasks
   (`FF-001` … `FF-1303`), sequenced by dependency in plan §6, with explicit
   ordering constraints that cannot be reordered: schema before everything, RBAC
   before any module endpoint, vehicles before maintenance/documents/damages,
   maintenance and documents before notifications, everything before reports.

2. **Task ids in the source itself.** Almost every file carries its `FF-` task id
   in the header comment. The mapping from task to file is therefore read out of
   the code rather than guessed, and commit boundaries follow it.

3. **Filesystem timestamps and migration names.** File mtimes span 7 August to
   2 September 2026, and the Prisma migration directories are timestamped
   `20260808`, `20260814` and `20260815`. Commit dates were chosen to sit within
   the windows these establish.

## What is true about these commits

- The **final commit's tree is byte-identical** to the source tree as it was
  found. Nothing was reformatted, reordered, added, or removed. Project
  functionality is unchanged.
- Commit **ordering respects real technical dependencies**. Nothing is introduced
  before what it needs.
- Commit **dates are chronological** and fall within the range the evidence
  supports.

## What is *not* true about these commits

Read this section before treating any individual commit as a historical fact.

- **Each commit contains its files' final content**, placed at the point where
  that file was logically introduced. Only the final revision of any file
  survives, so there is no record of how it looked in between.

- **Intermediate commits are not independently buildable, and do not pass their
  own tests.** `apps/api/src/app.ts` in commit 5 already mounts all ten module
  routers; the root `package.json` in commit 2 already lists every dependency the
  project ever acquired. `git checkout` of a middle commit will not produce a
  working application. Only `main` is guaranteed to build.

- **`package-lock.json` appears once, complete.** In reality it changed with
  nearly every dependency added across the project.

- **The E12 defect fixes (FF-1208) have no commit of their own.**
  [`docs/TASKS.md`](docs/TASKS.md) records five real defects found and fixed
  during QA — the role-change token cutoff, blank optional form fields, the
  driver damage-report `defaultValues` bug, CSV formula injection, and the 36 s
  notification run. Their fixes live inside files that must be committed earlier
  in the sequence. Isolating them into a remediation commit would have required
  writing the pre-fix versions of code that no longer exists, which would mean
  inventing source that was never in this project. That was not done.

- **Commit authorship is nominal.** All commits are attributed to the repository
  owner. The work was AI-assisted throughout, and the reconstruction cannot
  attribute any particular line to any particular tool or session.

- **`docs/TASKS.md` and `docs/IMPLEMENTATION_PLAN.md` are committed first, in
  their final form** — including the delivery notes written on 15 August. They
  were the project's starting point and also its running record, and only the end
  state of that record survives.

## Consequences for using this history

`git bisect`, `git blame` and "when did this break?" questions will produce
answers, and those answers will be **misleading**. A blame line pointing at
commit 15 means "this file was introduced during the maintenance phase", not
"this line was written on 14 August". Bisecting a regression will fail, because
the regression was never introduced by any of these commits — the tree only ever
existed in one state.

Treat this history as **documentation of the project's structure and build
order**. Do not treat it as forensic evidence.

---

*Reconstruction performed 6 September 2026.*
