/**
 * Damage reports — FF-701, FF-702 (DMG-01…04).
 *
 * The write path a driver actually uses. Two rules shape everything here:
 *
 *   a driver may report only on the vehicle they currently hold (DMG-03)
 *   a driver may not edit or withdraw a report once filed
 *
 * The second is a product decision as much as a permission: the fleet manager's
 * queue is a record of what was reported, and a report that can be rewritten
 * after someone has acted on it is not a record.
 */

import {
  OPEN_DAMAGE_STATUSES,
  canTransitionDamage,
  type ChangeDamageStatusRequest,
  type ConvertToMaintenanceRequest,
  type CreateDamageRequest,
  type Damage,
  type DamageListQuery,
  type MaintenanceOp,
  type Paginated,
  type UpdateDamageRequest,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { canReachVehicle, damageScope, type CallerScope } from '../../platform/scope.js';

const log = childLogger('damages');

const DAMAGE_SELECT = {
  id: true,
  vehicleId: true,
  reportedByUserId: true,
  driverId: true,
  description: true,
  severity: true,
  occurredAt: true,
  location: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  vehicle: { select: { plate: true, make: true, model: true } },
  reportedBy: { select: { name: true } },
  driver: { select: { firstName: true, lastName: true } },
  maintenanceOp: {
    select: {
      id: true,
      title: true,
      status: true,
      costTotal: true,
      currency: true,
      completedAt: true,
      mechanic: { select: { name: true } },
    },
  },
} as const;

type DamageRow = Prisma.DamageGetPayload<{ select: typeof DAMAGE_SELECT }>;

async function toDamage(row: DamageRow): Promise<Damage> {
  const photoCount = await prisma.attachment.count({
    where: { entityType: 'DAMAGE', entityId: row.id, uploadState: 'READY' },
  });

  return {
    id: row.id,
    vehicleId: row.vehicleId,
    plate: row.vehicle.plate,
    make: row.vehicle.make,
    model: row.vehicle.model,
    reportedById: row.reportedByUserId,
    reportedByName: row.reportedBy.name,
    driverId: row.driverId,
    driverName: row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : null,
    description: row.description,
    severity: row.severity,
    occurredAt: row.occurredAt.toISOString(),
    location: row.location,
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    // DMG-02's "visible from both sides" — one column, read in reverse.
    maintenanceOp: row.maintenanceOp
      ? {
          id: row.maintenanceOp.id,
          title: row.maintenanceOp.title,
          status: row.maintenanceOp.status,
          costTotal: row.maintenanceOp.costTotal.toFixed(2),
          currency: row.maintenanceOp.currency,
          completedAt: row.maintenanceOp.completedAt?.toISOString() ?? null,
          mechanicName: row.maintenanceOp.mechanic?.name ?? null,
        }
      : null,
    photoCount,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireDamage(id: string, caller: CallerScope): Promise<DamageRow> {
  const scope = await damageScope(caller);
  const row = await prisma.damage.findFirst({
    where: { AND: [scope, { id }] },
    select: DAMAGE_SELECT,
  });
  if (!row) throw new NotFoundError('Damage report');
  return row;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(
  query: DamageListQuery,
  caller: CallerScope,
): Promise<Paginated<Damage>> {
  const filters: Prisma.DamageWhereInput[] = [await damageScope(caller)];

  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.status) filters.push({ status: query.status });
  if (query.severity) filters.push({ severity: query.severity });
  if (query.open) filters.push({ status: { in: [...OPEN_DAMAGE_STATUSES] } });
  // Archived reports leave the queue but stay in history and reports.
  if (!query.includeArchived) filters.push({ archivedAt: null });

  if (query.q) {
    filters.push({
      OR: [
        { description: { contains: query.q, mode: 'insensitive' } },
        { location: { contains: query.q, mode: 'insensitive' } },
        { vehicle: { plate: { contains: query.q, mode: 'insensitive' } } },
      ],
    });
  }

  const where: Prisma.DamageWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.damage.findMany({
      where,
      select: DAMAGE_SELECT,
      // Most recent first: a triage queue is worked newest-first, and severity
      // is a filter rather than an order so nothing is buried by age.
      orderBy: { occurredAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.damage.count({ where }),
  ]);

  return {
    data: await Promise.all(rows.map(toDamage)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getById(id: string, caller: CallerScope): Promise<Damage> {
  return toDamage(await requireDamage(id, caller));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * DMG-03.
 *
 * The vehicle is named in the body, so no `where` fragment can constrain it —
 * `canReachVehicle` is what stops a driver filing a report against a van they
 * do not hold. Their own driver record is attached so authorship survives a
 * later reassignment.
 */
export async function create(
  input: CreateDamageRequest,
  caller: CallerScope,
  reportedById: string,
): Promise<Damage> {
  if (!(await canReachVehicle(caller, input.vehicleId))) {
    throw new ValidationError([
      {
        path: 'body.vehicleId',
        message:
          caller.scope === 'own_vehicle'
            ? 'You can only report a problem on the vehicle assigned to you.'
            : 'No such vehicle.',
      },
    ]);
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: input.vehicleId },
    select: { status: true },
  });
  if (vehicle?.status === 'ARCHIVED') {
    throw new ConflictError('This vehicle is archived. Restore it before reporting a problem.');
  }

  const row = await prisma.damage.create({
    data: {
      vehicleId: input.vehicleId,
      reportedByUserId: reportedById,
      driverId: caller.driverId,
      description: input.description,
      severity: input.severity,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      location: input.location ?? null,
      status: 'REPORTED',
    },
    select: DAMAGE_SELECT,
  });

  log.info(
    { damageId: row.id, vehicleId: input.vehicleId, severity: input.severity },
    'Damage reported',
  );
  return toDamage(row);
}

export async function update(
  id: string,
  input: UpdateDamageRequest,
  caller: CallerScope,
): Promise<Damage> {
  const existing = await requireDamage(id, caller);

  // Belt and braces: the matrix already denies a driver `update` on damages, so
  // this is unreachable today. It stays because the rule is a product decision
  // — a filed report is a record — and should not depend on one matrix cell.
  if (caller.scope === 'own_vehicle') {
    throw new ForbiddenError('A report cannot be changed once it has been filed.');
  }

  if (existing.status === 'RESOLVED' || existing.status === 'REJECTED') {
    throw new ConflictError('This report has been closed and can no longer be edited.');
  }

  const row = await prisma.damage.update({
    where: { id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
    },
    select: DAMAGE_SELECT,
  });

  return toDamage(row);
}

export async function changeStatus(
  id: string,
  input: ChangeDamageStatusRequest,
  caller: CallerScope,
): Promise<Damage> {
  const existing = await requireDamage(id, caller);

  if (!canTransitionDamage(existing.status, input.status)) {
    throw new ConflictError(
      existing.status === 'LINKED'
        ? 'This report has a maintenance job attached. Complete or delete the job first.'
        : `A report that is ${existing.status.toLowerCase().replace('_', ' ')} cannot become ${input.status.toLowerCase().replace('_', ' ')}.`,
    );
  }

  const row = await prisma.damage.update({
    where: { id },
    data: {
      status: input.status,
      // The triage note is appended rather than replacing the driver's words:
      // what they reported and what was decided are different facts.
      ...(input.note ? { description: `${existing.description}\n\n— ${input.note}` } : {}),
    },
    select: DAMAGE_SELECT,
  });

  log.info({ damageId: id, from: existing.status, to: input.status }, 'Damage status changed');
  return toDamage(row);
}

/** DMG-01 — archived reports leave the queue and stay in the record. */
export async function setArchived(
  id: string,
  archived: boolean,
  caller: CallerScope,
): Promise<Damage> {
  await requireDamage(id, caller);
  const row = await prisma.damage.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
    select: DAMAGE_SELECT,
  });
  return toDamage(row);
}

export async function remove(id: string, caller: CallerScope): Promise<void> {
  const existing = await requireDamage(id, caller);

  if (existing.maintenanceOp) {
    throw new ConflictError(
      'This report has a maintenance job attached. Delete the job first, or archive the report instead.',
    );
  }

  await prisma.damage.update({ where: { id }, data: { deletedAt: new Date() } });
  log.info({ damageId: id }, 'Damage report deleted');
}

// ---------------------------------------------------------------------------
// DMG-02 — conversion
// ---------------------------------------------------------------------------

/**
 * Turns a report into an unexpected maintenance job.
 *
 * The acceptance criterion is that the two are visible from each other. That is
 * one column — `maintenance_ops.damage_id`, unique — read forwards by the job
 * and in reverse by the report. Two columns pointing at each other could
 * disagree, and then "which is right" has no answer.
 *
 * Both writes happen in one transaction: a job whose report is not marked
 * LINKED would reappear in the triage queue and be converted twice.
 */
export async function convertToMaintenance(
  id: string,
  input: ConvertToMaintenanceRequest,
  caller: CallerScope,
): Promise<{ damage: Damage; operation: Pick<MaintenanceOp, 'id' | 'title' | 'status'> }> {
  const existing = await requireDamage(id, caller);

  if (existing.maintenanceOp) {
    throw new ConflictError('A maintenance job has already been raised from this report.');
  }
  if (existing.status === 'RESOLVED' || existing.status === 'REJECTED') {
    throw new ConflictError('This report has been closed.');
  }

  if (input.mechanicId) {
    const mechanic = await prisma.user.findUnique({
      where: { id: input.mechanicId },
      select: { role: true, isActive: true },
    });
    if (!mechanic || mechanic.role !== 'MECHANIC') {
      throw new ValidationError([
        { path: 'body.mechanicId', message: 'Only a user with the Mechanic role can be assigned.' },
      ]);
    }
    if (!mechanic.isActive) throw new ConflictError('That mechanic is deactivated.');
  }

  // A sensible default title, so a manager triaging twenty reports does not
  // have to retype the driver's first line each time.
  const title =
    input.title ??
    `Repair: ${existing.description.split('\n')[0]?.slice(0, 120) ?? 'reported damage'}`;

  const result = await prisma.$transaction(async (tx) => {
    const operation = await tx.maintenanceOp.create({
      data: {
        vehicleId: existing.vehicleId,
        damageId: existing.id,
        kind: 'UNEXPECTED',
        title,
        description: existing.description,
        status: 'PLANNED',
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
        mechanicId: input.mechanicId ?? null,
      },
      select: { id: true, title: true, status: true },
    });

    await tx.damage.update({ where: { id }, data: { status: 'LINKED' } });

    return operation;
  });

  log.info({ damageId: id, operationId: result.id }, 'Damage converted to maintenance');

  return {
    damage: await getById(id, caller),
    operation: result,
  };
}
