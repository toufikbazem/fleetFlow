/**
 * Maintenance trigger engine — FF-503, MNT-02 / MNT-06.
 *
 * Turns plans into jobs. Two passes:
 *
 *   1. generate  for each active plan × covered vehicle, work out when the next
 *                service falls due and create it once it is inside the notice
 *                window.
 *   2. sweep     mark planned work whose due date or mileage has passed as
 *                OVERDUE, so the dashboard and NTF-04 have something to read.
 *
 * **This is the task whose failure is silent.** A reminder that never fires
 * looks exactly like a fleet with nothing due — there is no error, no empty
 * screen, nothing to notice. Three properties are therefore built in rather
 * than assumed:
 *
 *   Idempotent   running twice creates nothing the second time, guaranteed by a
 *                partial unique index rather than by a read-then-write check
 *                that two concurrent runs would both pass.
 *   Deterministic  `now` is a parameter, never `new Date()` inside the logic,
 *                so the whole engine can be driven against a fixed clock.
 *   Bounded      a vehicle with years of unrecorded history produces the *next*
 *                due service, not forty overdue ones.
 */

import { OPERATIONAL_VEHICLE_STATUSES, type TriggerRunResult } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { childLogger } from '../../platform/logger.js';

const log = childLogger('trigger-engine');

const DAY_MS = 86_400_000;

/** Midnight UTC. Due dates are calendar dates, not moments. */
function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * The next occurrence at or after `today`, starting from `baseline`.
 *
 * A van bought four years ago on an annual inspection plan, with no recorded
 * history, must not generate four overdue inspections the first time the engine
 * runs — that is noise nobody can act on, and it buries the one real job. The
 * loop is bounded by arithmetic rather than iteration for the same reason.
 */
export function nextDueDate(baseline: Date, intervalDays: number, today: Date): Date {
  const start = startOfDay(baseline);
  const now = startOfDay(today);

  if (start >= now) return start;

  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const periods = Math.ceil(elapsed / intervalDays);
  return addDays(start, periods * intervalDays);
}

/**
 * The next odometer milestone at or above the current reading.
 *
 * With completed history, the next service is one interval past the last one.
 * Without it, the reading is rounded up to the next multiple — a van already on
 * 84 500 km with a 15 000 km plan is next due at 90 000, not at 15 000.
 */
export function nextDueMileage(
  currentMileage: number,
  intervalKm: number,
  lastCompletedMileage: number | null,
): number {
  if (lastCompletedMileage !== null) return lastCompletedMileage + intervalKm;
  return (Math.floor(currentMileage / intervalKm) + 1) * intervalKm;
}

interface PlanRow {
  id: string;
  name: string;
  vehicleId: string | null;
  vehicleTypeId: string | null;
  triggerType: 'DATE' | 'MILEAGE' | 'BOTH';
  intervalDays: number | null;
  intervalKm: number | null;
  noticeDays: number;
  noticeKm: number;
}

interface VehicleRow {
  id: string;
  plate: string;
  currentMileage: number;
  purchaseDate: Date | null;
  createdAt: Date;
}

/** Vehicles a plan covers. Archived vehicles are excluded — nobody services them. */
async function vehiclesForPlan(plan: PlanRow): Promise<VehicleRow[]> {
  const select = {
    id: true,
    plate: true,
    currentMileage: true,
    purchaseDate: true,
    createdAt: true,
  } as const;

  if (plan.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: plan.vehicleId, status: { in: [...OPERATIONAL_VEHICLE_STATUSES] } },
      select,
    });
    return vehicle ? [vehicle] : [];
  }

  if (!plan.vehicleTypeId) return [];

  return prisma.vehicle.findMany({
    where: {
      vehicleTypeId: plan.vehicleTypeId,
      status: { in: [...OPERATIONAL_VEHICLE_STATUSES] },
    },
    select,
  });
}

export interface TriggerRunOptions {
  /** Injected so the engine can be driven against a fixed clock. */
  now?: Date;
  /** Restricts the run to one plan — used by the manual re-run endpoint. */
  planId?: string;
}

export async function runTriggerEngine(options: TriggerRunOptions = {}): Promise<TriggerRunResult> {
  const now = options.now ?? new Date();
  const today = startOfDay(now);

  const plans = (await prisma.maintenancePlan.findMany({
    where: { isActive: true, ...(options.planId ? { id: options.planId } : {}) },
    select: {
      id: true,
      name: true,
      vehicleId: true,
      vehicleTypeId: true,
      triggerType: true,
      intervalDays: true,
      intervalKm: true,
      noticeDays: true,
      noticeKm: true,
    },
  })) as PlanRow[];

  const created: TriggerRunResult['created'] = [];
  let vehiclesEvaluated = 0;

  for (const plan of plans) {
    const vehicles = await vehiclesForPlan(plan);
    vehiclesEvaluated += vehicles.length;

    for (const vehicle of vehicles) {
      // An open job for this plan and vehicle means the last one generated has
      // not been dealt with. Generating another would produce a queue of
      // duplicates for a service that only needs doing once.
      const open = await prisma.maintenanceOp.count({
        where: { planId: plan.id, vehicleId: vehicle.id, status: { not: 'COMPLETED' } },
      });
      if (open > 0) continue;

      const lastCompleted = await prisma.maintenanceOp.findFirst({
        where: { planId: plan.id, vehicleId: vehicle.id, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        select: { completedAt: true, completedMileage: true },
      });

      let dueDate: Date | null = null;
      let dueMileage: number | null = null;
      let dateDue = false;
      let mileageDue = false;

      if ((plan.triggerType === 'DATE' || plan.triggerType === 'BOTH') && plan.intervalDays) {
        // With no history, the clock starts at purchase — or at the record's
        // creation for a vehicle that predates FleetFlow.
        const baseline = lastCompleted?.completedAt ?? vehicle.purchaseDate ?? vehicle.createdAt;
        dueDate = nextDueDate(baseline, plan.intervalDays, today);
        dateDue = dueDate.getTime() - today.getTime() <= plan.noticeDays * DAY_MS;
      }

      if ((plan.triggerType === 'MILEAGE' || plan.triggerType === 'BOTH') && plan.intervalKm) {
        dueMileage = nextDueMileage(
          vehicle.currentMileage,
          plan.intervalKm,
          lastCompleted?.completedMileage ?? null,
        );
        mileageDue = vehicle.currentMileage + plan.noticeKm >= dueMileage;
      }

      // BOTH means whichever comes first, not both at once: a van that reaches
      // its mileage in four months should be serviced then, not held to the
      // annual date.
      if (!dateDue && !mileageDue) continue;

      try {
        const operation = await prisma.maintenanceOp.create({
          data: {
            vehicleId: vehicle.id,
            planId: plan.id,
            kind: 'SCHEDULED',
            title: plan.name,
            status: 'PLANNED',
            dueDate,
            dueMileage,
          },
          select: { id: true },
        });

        created.push({
          operationId: operation.id,
          plate: vehicle.plate,
          planName: plan.name,
          dueDate: dueDate ? (dueDate.toISOString().split('T')[0] ?? null) : null,
          dueMileage,
        });
      } catch (error) {
        // The partial unique index rejected it: a concurrent run got there
        // first. That is the guard working, not a failure — skip and continue.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          log.debug(
            { planId: plan.id, vehicleId: vehicle.id },
            'Operation already created by a concurrent run',
          );
          continue;
        }
        throw error;
      }
    }
  }

  const markedOverdue = await sweepOverdue(today);

  const result: TriggerRunResult = {
    ranAt: now.toISOString(),
    plansEvaluated: plans.length,
    vehiclesEvaluated,
    operationsCreated: created.length,
    markedOverdue,
    created,
  };

  log.info(
    {
      plans: result.plansEvaluated,
      vehicles: result.vehiclesEvaluated,
      created: result.operationsCreated,
      overdue: result.markedOverdue,
    },
    'Trigger engine run complete',
  );

  return result;
}

/**
 * Marks planned work whose due point has passed.
 *
 * Only PLANNED work is swept. A job already IN_PROGRESS is being dealt with,
 * and relabelling it "overdue" would hide the fact that someone is on it — the
 * useful signal for a fleet manager is *nobody has started this*, which is what
 * the dashboard's overdue counter and NTF-04 are for.
 */
export async function sweepOverdue(today: Date): Promise<number> {
  const candidates = await prisma.maintenanceOp.findMany({
    where: {
      status: 'PLANNED',
      OR: [{ dueDate: { lt: today } }, { dueMileage: { not: null } }],
    },
    select: {
      id: true,
      dueDate: true,
      dueMileage: true,
      vehicle: { select: { currentMileage: true } },
    },
  });

  const overdueIds = candidates
    .filter((op) => {
      const pastDate = op.dueDate !== null && op.dueDate < today;
      const pastMileage = op.dueMileage !== null && op.vehicle.currentMileage >= op.dueMileage;
      return pastDate || pastMileage;
    })
    .map((op) => op.id);

  if (overdueIds.length === 0) return 0;

  const updated = await prisma.maintenanceOp.updateMany({
    where: { id: { in: overdueIds }, status: 'PLANNED' },
    data: { status: 'OVERDUE' },
  });

  return updated.count;
}
