/**
 * Maintenance operations — FF-502, FF-504 (MNT-01, MNT-05, MNT-06, MNT-07).
 */

import {
  canTransitionMaintenance,
  daysUntil,
  type AssignMechanicRequest,
  type ChangeMaintenanceStatusRequest,
  type CreateMaintenanceOpRequest,
  type MaintenanceOp,
  type MaintenanceOpListQuery,
  type Paginated,
  type UpdateMaintenanceOpRequest,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import {
  maintenanceScope,
  maintenanceScopeSql,
  vehicleScope,
  type CallerScope,
} from '../../platform/scope.js';
import { loadNotificationSettings } from '../notifications/rules.js';
import { bucketedOpIds } from './due-buckets.js';

const log = childLogger('maintenance-ops');

const OP_SELECT = {
  id: true,
  vehicleId: true,
  planId: true,
  damageId: true,
  kind: true,
  title: true,
  description: true,
  status: true,
  dueDate: true,
  dueMileage: true,
  startedAt: true,
  completedAt: true,
  completedMileage: true,
  mechanicId: true,
  costParts: true,
  costLabour: true,
  costTotal: true,
  currency: true,
  vendor: true,
  createdAt: true,
  vehicle: { select: { plate: true, make: true, model: true } },
  plan: { select: { name: true } },
  mechanic: { select: { name: true } },
} as const;

type OpRow = Prisma.MaintenanceOpGetPayload<{ select: typeof OP_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

function toOperation(row: OpRow): MaintenanceOp {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    plate: row.vehicle.plate,
    make: row.vehicle.make,
    model: row.vehicle.model,
    planId: row.planId,
    planName: row.plan?.name ?? null,
    damageId: row.damageId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    dueDate: dateOnly(row.dueDate),
    dueMileage: row.dueMileage,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedMileage: row.completedMileage,
    mechanicId: row.mechanicId,
    mechanicName: row.mechanic?.name ?? null,
    costParts: row.costParts.toFixed(2),
    costLabour: row.costLabour.toFixed(2),
    costTotal: row.costTotal.toFixed(2),
    currency: row.currency,
    vendor: row.vendor,
    daysUntilDue: row.dueDate ? daysUntil(row.dueDate) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listOperations(
  query: MaintenanceOpListQuery,
  caller: CallerScope,
): Promise<Paginated<MaintenanceOp>> {
  const filters: Prisma.MaintenanceOpWhereInput[] = [await maintenanceScope(caller)];

  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.status) filters.push({ status: query.status });
  if (query.kind) filters.push({ kind: query.kind });
  if (query.mechanicId) filters.push({ mechanicId: query.mechanicId });
  // `mine` saves a mechanic from having to know their own user id.
  if (query.mine) filters.push({ mechanicId: caller.userId });
  if (query.open) filters.push({ status: { not: 'COMPLETED' } });

  // `due` is resolved against the shared bucket definition rather than being
  // approximated with a status or a date range, so a dashboard counter and the
  // list it opens are computed by the same SQL and cannot disagree.
  if (query.due) {
    const notice = await loadNotificationSettings();
    const ids = await bucketedOpIds(
      query.due === 'overdue' ? 'OVERDUE' : 'UPCOMING',
      await maintenanceScopeSql(caller),
      Math.max(...notice.maintenanceNoticeDays),
      notice.maintenanceNoticeKm,
    );
    filters.push({ id: { in: ids } });
  }

  if (query.dueBefore)
    filters.push({ dueDate: { lte: new Date(`${query.dueBefore}T00:00:00.000Z`) } });

  if (query.q) {
    filters.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { vendor: { contains: query.q, mode: 'insensitive' } },
        { vehicle: { plate: { contains: query.q, mode: 'insensitive' } } },
      ],
    });
  }

  const where: Prisma.MaintenanceOpWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.maintenanceOp.findMany({
      where,
      select: OP_SELECT,
      // Overdue first, then soonest due: the order a workshop works through.
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.maintenanceOp.count({ where }),
  ]);

  return { data: rows.map(toOperation), page: query.page, pageSize: query.pageSize, total };
}

export async function getOperation(id: string, caller: CallerScope): Promise<MaintenanceOp> {
  const scope = await maintenanceScope(caller);
  const row = await prisma.maintenanceOp.findFirst({
    where: { AND: [scope, { id }] },
    select: OP_SELECT,
  });
  if (!row) throw new NotFoundError('Maintenance job');
  return toOperation(row);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function assertMechanic(mechanicId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: mechanicId },
    select: { role: true, isActive: true },
  });
  if (!user) {
    throw new ValidationError([{ path: 'body.mechanicId', message: 'No such user.' }]);
  }
  // The matrix gives MECHANIC write access to maintenance assigned to them.
  // Assigning to anyone else produces work the assignee cannot open.
  if (user.role !== 'MECHANIC') {
    throw new ValidationError([
      {
        path: 'body.mechanicId',
        message: 'Only a user with the Mechanic role can be assigned work.',
      },
    ]);
  }
  if (!user.isActive) {
    throw new ConflictError('That mechanic is deactivated.');
  }
}

export async function createOperation(
  input: CreateMaintenanceOpRequest,
  caller: CallerScope,
): Promise<MaintenanceOp> {
  // Checked against the caller's *vehicle* scope, not their maintenance scope:
  // creating a job names a vehicle in the body, so a `where` fragment on the
  // maintenance table cannot constrain it. Only ADMIN and FLEET_MANAGER can
  // reach this today — both unscoped — but the check means granting create to
  // a scoped role later cannot silently allow work on any vehicle in the fleet.
  const scope = await vehicleScope(caller);
  const vehicle = await prisma.vehicle.findFirst({
    where: { AND: [scope, { id: input.vehicleId }] },
    select: { id: true, status: true },
  });
  if (!vehicle) {
    throw new ValidationError([{ path: 'body.vehicleId', message: 'No such vehicle.' }]);
  }
  if (vehicle.status === 'ARCHIVED') {
    throw new ConflictError(
      'This vehicle is archived. Return it to service before scheduling work.',
    );
  }

  if (input.mechanicId) await assertMechanic(input.mechanicId);

  const costParts = new Prisma.Decimal(input.costParts ?? '0');
  const costLabour = new Prisma.Decimal(input.costLabour ?? '0');

  const row = await prisma.maintenanceOp.create({
    data: {
      vehicleId: input.vehicleId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      status: 'PLANNED',
      dueDate: toDate(input.dueDate) ?? null,
      dueMileage: input.dueMileage ?? null,
      mechanicId: input.mechanicId ?? null,
      costParts,
      costLabour,
      // Written explicitly and pinned by a CHECK constraint, so an exported
      // figure can never disagree with the dashboard (RPT-06 acceptance).
      costTotal: costParts.add(costLabour),
      vendor: input.vendor ?? null,
    },
    select: OP_SELECT,
  });

  log.info({ operationId: row.id, vehicleId: input.vehicleId }, 'Maintenance job created');
  return toOperation(row);
}

export async function updateOperation(
  id: string,
  input: UpdateMaintenanceOpRequest,
  caller: CallerScope,
): Promise<MaintenanceOp> {
  const existing = await getOperation(id, caller);

  if (existing.status === 'COMPLETED') {
    // Completed work is the source for cost reports. Editing it after the fact
    // would change figures someone has already reconciled.
    throw new ConflictError('This job is completed. Completed work cannot be edited.');
  }

  const costParts = new Prisma.Decimal(input.costParts ?? existing.costParts);
  const costLabour = new Prisma.Decimal(input.costLabour ?? existing.costLabour);

  const row = await prisma.maintenanceOp.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.dueDate !== undefined ? { dueDate: toDate(input.dueDate) } : {}),
      ...(input.dueMileage !== undefined ? { dueMileage: input.dueMileage } : {}),
      ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
      ...(input.costParts !== undefined || input.costLabour !== undefined
        ? { costParts, costLabour, costTotal: costParts.add(costLabour) }
        : {}),
    },
    select: OP_SELECT,
  });

  return toOperation(row);
}

/**
 * MNT-06.
 *
 * Completion is the point at which a job stops being work and becomes a cost
 * record, so it captures the odometer and the final figures. The mileage also
 * feeds the next cycle: the trigger engine measures the following service from
 * `completed_mileage`, not from wherever the vehicle happens to be later.
 */
export async function changeStatus(
  id: string,
  input: ChangeMaintenanceStatusRequest,
  caller: CallerScope,
): Promise<MaintenanceOp> {
  const existing = await getOperation(id, caller);

  if (!canTransitionMaintenance(existing.status, input.status)) {
    throw new ConflictError(
      existing.status === 'COMPLETED'
        ? 'This job is completed. Correct the record instead of reopening it.'
        : `A job that is ${existing.status.toLowerCase().replace('_', ' ')} cannot become ${input.status.toLowerCase().replace('_', ' ')}.`,
    );
  }

  const now = new Date();
  const data: Prisma.MaintenanceOpUpdateInput = { status: input.status };

  if (input.status === 'IN_PROGRESS' && !existing.startedAt) {
    data.startedAt = now;
  }

  if (input.status === 'COMPLETED') {
    data.completedAt = now;
    // Never started explicitly — a job completed in one visit still needs a
    // start, or the CHECK that completion follows start has nothing to compare.
    if (!existing.startedAt) data.startedAt = now;

    if (input.completedMileage !== undefined) {
      data.completedMileage = input.completedMileage;

      // The workshop reading is a real observation of the odometer, so it
      // updates the vehicle — but only upward, for the same reason a manual
      // reading cannot silently lower it (VEH-05).
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: existing.vehicleId },
        select: { currentMileage: true },
      });
      if (vehicle && input.completedMileage > vehicle.currentMileage) {
        await prisma.$transaction([
          prisma.vehicle.update({
            where: { id: existing.vehicleId },
            data: { currentMileage: input.completedMileage },
          }),
          prisma.mileageReading.create({
            data: {
              vehicleId: existing.vehicleId,
              mileage: input.completedMileage,
              source: 'MAINTENANCE',
              note: `Recorded on completing "${existing.title}"`,
            },
          }),
        ]);
      }
    }

    const costParts = new Prisma.Decimal(input.costParts ?? existing.costParts);
    const costLabour = new Prisma.Decimal(input.costLabour ?? existing.costLabour);
    data.costParts = costParts;
    data.costLabour = costLabour;
    data.costTotal = costParts.add(costLabour);
  }

  const row = await prisma.maintenanceOp.update({ where: { id }, data, select: OP_SELECT });

  // DMG-02, the far end: a report exists because something was broken, so
  // finishing the repair is what resolves it. Leaving it LINKED would keep a
  // fixed problem sitting in the triage queue, and someone would eventually
  // close it by hand — or not.
  if (input.status === 'COMPLETED' && existing.damageId) {
    await prisma.damage.update({
      where: { id: existing.damageId },
      data: { status: 'RESOLVED' },
    });
    log.info({ damageId: existing.damageId, operationId: id }, 'Damage resolved by completed job');
  }

  log.info(
    { operationId: id, from: existing.status, to: input.status },
    'Maintenance status changed',
  );
  return toOperation(row);
}

/** MNT-07. */
export async function assignMechanic(
  id: string,
  input: AssignMechanicRequest,
  caller: CallerScope,
): Promise<MaintenanceOp> {
  const existing = await getOperation(id, caller);

  if (existing.status === 'COMPLETED') {
    throw new ConflictError('This job is completed. Reassigning it would rewrite the record.');
  }

  if (input.mechanicId) await assertMechanic(input.mechanicId);

  const row = await prisma.maintenanceOp.update({
    where: { id },
    data: { mechanicId: input.mechanicId },
    select: OP_SELECT,
  });

  log.info({ operationId: id, mechanicId: input.mechanicId }, 'Mechanic assigned');
  return toOperation(row);
}

export async function deleteOperation(id: string, caller: CallerScope): Promise<void> {
  const existing = await getOperation(id, caller);

  if (existing.status === 'COMPLETED') {
    throw new ConflictError('Completed work stays in the cost history and cannot be deleted.');
  }

  await prisma.maintenanceOp.update({ where: { id }, data: { deletedAt: new Date() } });
  log.info({ operationId: id }, 'Maintenance job deleted');
}
