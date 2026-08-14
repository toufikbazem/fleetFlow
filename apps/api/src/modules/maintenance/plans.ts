/**
 * Maintenance plans — FF-501, MNT-04.
 *
 * A plan is a rule, not a job. It produces jobs through the trigger engine
 * (FF-503); nothing here creates work directly.
 */

import type {
  CreateMaintenancePlanRequest,
  MaintenancePlan,
  MaintenancePlanListQuery,
  Paginated,
  UpdateMaintenancePlanRequest,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';

const log = childLogger('maintenance-plans');

const PLAN_SELECT = {
  id: true,
  name: true,
  description: true,
  vehicleId: true,
  vehicleTypeId: true,
  triggerType: true,
  intervalDays: true,
  intervalKm: true,
  noticeDays: true,
  noticeKm: true,
  isActive: true,
  createdAt: true,
  vehicle: { select: { plate: true } },
  vehicleType: { select: { name: true } },
} as const;

type PlanRow = Prisma.MaintenancePlanGetPayload<{ select: typeof PLAN_SELECT }>;

function toPlan(row: PlanRow, appliesTo: number): MaintenancePlan {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    vehicleId: row.vehicleId,
    vehiclePlate: row.vehicle?.plate ?? null,
    vehicleTypeId: row.vehicleTypeId,
    vehicleTypeName: row.vehicleType?.name ?? null,
    triggerType: row.triggerType,
    intervalDays: row.intervalDays,
    intervalKm: row.intervalKm,
    noticeDays: row.noticeDays,
    noticeKm: row.noticeKm,
    isActive: row.isActive,
    appliesTo,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * How many vehicles a plan currently covers.
 *
 * Shown in the list because a type-scoped plan silently covering zero vehicles
 * looks identical to one covering forty, and the difference is whether anything
 * will ever be generated from it.
 */
async function countCoverage(rows: PlanRow[]): Promise<Map<string, number>> {
  const typeIds = [...new Set(rows.map((row) => row.vehicleTypeId).filter(Boolean))] as string[];

  const byType = new Map<string, number>();
  if (typeIds.length > 0) {
    const grouped = await prisma.vehicle.groupBy({
      by: ['vehicleTypeId'],
      where: { vehicleTypeId: { in: typeIds }, status: { not: 'ARCHIVED' } },
      _count: { _all: true },
    });
    for (const group of grouped) {
      if (group.vehicleTypeId) byType.set(group.vehicleTypeId, group._count._all);
    }
  }

  const coverage = new Map<string, number>();
  for (const row of rows) {
    coverage.set(row.id, row.vehicleId ? 1 : (byType.get(row.vehicleTypeId ?? '') ?? 0));
  }
  return coverage;
}

export async function listPlans(
  query: MaintenancePlanListQuery,
): Promise<Paginated<MaintenancePlan>> {
  const filters: Prisma.MaintenancePlanWhereInput[] = [];
  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.vehicleTypeId) filters.push({ vehicleTypeId: query.vehicleTypeId });
  if (query.isActive !== undefined) filters.push({ isActive: query.isActive });
  if (query.q) filters.push({ name: { contains: query.q, mode: 'insensitive' } });

  const where: Prisma.MaintenancePlanWhereInput = filters.length ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.maintenancePlan.findMany({
      where,
      select: PLAN_SELECT,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.maintenancePlan.count({ where }),
  ]);

  const coverage = await countCoverage(rows);
  return {
    data: rows.map((row) => toPlan(row, coverage.get(row.id) ?? 0)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getPlan(id: string): Promise<MaintenancePlan> {
  const row = await prisma.maintenancePlan.findUnique({ where: { id }, select: PLAN_SELECT });
  if (!row) throw new NotFoundError('Maintenance plan');
  const coverage = await countCoverage([row]);
  return toPlan(row, coverage.get(row.id) ?? 0);
}

export async function createPlan(input: CreateMaintenancePlanRequest): Promise<MaintenancePlan> {
  // The target must exist before a plan points at it; the FK would say so too,
  // but a named field error is more use than a raw constraint violation.
  if (input.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
    if (!vehicle)
      throw new ValidationError([{ path: 'body.vehicleId', message: 'No such vehicle.' }]);
  }
  if (input.vehicleTypeId) {
    const type = await prisma.vehicleType.findUnique({ where: { id: input.vehicleTypeId } });
    if (!type) {
      throw new ValidationError([{ path: 'body.vehicleTypeId', message: 'No such vehicle type.' }]);
    }
  }

  const row = await prisma.maintenancePlan.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      triggerType: input.triggerType,
      intervalDays: input.intervalDays ?? null,
      intervalKm: input.intervalKm ?? null,
      noticeDays: input.noticeDays,
      noticeKm: input.noticeKm,
      ...(input.vehicleId ? { vehicle: { connect: { id: input.vehicleId } } } : {}),
      ...(input.vehicleTypeId ? { vehicleType: { connect: { id: input.vehicleTypeId } } } : {}),
    },
    select: PLAN_SELECT,
  });

  log.info({ planId: row.id, trigger: row.triggerType }, 'Maintenance plan created');
  const coverage = await countCoverage([row]);
  return toPlan(row, coverage.get(row.id) ?? 0);
}

export async function updatePlan(
  id: string,
  input: UpdateMaintenancePlanRequest,
): Promise<MaintenancePlan> {
  const existing = await prisma.maintenancePlan.findUnique({
    where: { id },
    select: { id: true, triggerType: true, intervalDays: true, intervalKm: true },
  });
  if (!existing) throw new NotFoundError('Maintenance plan');

  // Clearing the interval a plan triggers on would leave it unable to compute a
  // due point — the plan would still look active and generate nothing.
  const nextDays = input.intervalDays ?? existing.intervalDays;
  const nextKm = input.intervalKm ?? existing.intervalKm;

  if ((existing.triggerType === 'DATE' || existing.triggerType === 'BOTH') && !nextDays) {
    throw new ValidationError([
      {
        path: 'body.intervalDays',
        message: 'This plan triggers on dates and needs an interval in days.',
      },
    ]);
  }
  if ((existing.triggerType === 'MILEAGE' || existing.triggerType === 'BOTH') && !nextKm) {
    throw new ValidationError([
      {
        path: 'body.intervalKm',
        message: 'This plan triggers on mileage and needs an interval in kilometres.',
      },
    ]);
  }

  const row = await prisma.maintenancePlan.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.intervalDays !== undefined ? { intervalDays: input.intervalDays } : {}),
      ...(input.intervalKm !== undefined ? { intervalKm: input.intervalKm } : {}),
      ...(input.noticeDays !== undefined ? { noticeDays: input.noticeDays } : {}),
      ...(input.noticeKm !== undefined ? { noticeKm: input.noticeKm } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: PLAN_SELECT,
  });

  const coverage = await countCoverage([row]);
  return toPlan(row, coverage.get(row.id) ?? 0);
}

/**
 * Soft-deletes a plan.
 *
 * Operations it already generated keep their `plan_id` and stay in the cost
 * history — deleting the rule must not rewrite what was done because of it.
 * Open jobs block deletion, because an unfinished service whose plan has gone
 * is work nobody will be told about again.
 */
export async function deletePlan(id: string): Promise<void> {
  const open = await prisma.maintenanceOp.count({
    where: { planId: id, status: { not: 'COMPLETED' } },
  });
  if (open > 0) {
    throw new ConflictError(
      open === 1
        ? 'This plan has an open job. Complete or cancel it before deleting the plan.'
        : `This plan has ${open} open jobs. Complete or cancel them before deleting the plan.`,
    );
  }

  await prisma.maintenancePlan.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  log.info({ planId: id }, 'Maintenance plan deleted');
}
