/**
 * Assignments — FF-404 (DRV-02, DRV-03, VEH-03).
 *
 * Decision Q5 says one driver per vehicle. The database enforces it with a
 * partial unique index on open assignments; this layer's job is to make the
 * common case — handing a vehicle to somebody else — work in one step without
 * ever overwriting the record of who had it before.
 */

import type {
  Assignment,
  AssignmentListQuery,
  CloseAssignmentRequest,
  CreateAssignmentRequest,
  Paginated,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { vehicleScope, type CallerScope } from '../../platform/scope.js';

const log = childLogger('assignments');

const ASSIGNMENT_SELECT = {
  id: true,
  vehicleId: true,
  driverId: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  vehicle: { select: { plate: true, make: true, model: true } },
  driver: { select: { firstName: true, lastName: true } },
  endedBy: { select: { name: true } },
} as const;

type AssignmentRow = Prisma.AssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    plate: row.vehicle.plate,
    make: row.vehicle.make,
    model: row.vehicle.model,
    driverId: row.driverId,
    driverName: `${row.driver.firstName} ${row.driver.lastName}`,
    startDate: dateOnly(row.startDate) ?? '',
    endDate: dateOnly(row.endDate),
    endedByName: row.endedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(
  query: AssignmentListQuery,
  caller: CallerScope,
): Promise<Paginated<Assignment>> {
  // Scoped through the vehicle: a driver may see the history of the vehicle
  // they hold, and nothing else.
  const scope = await vehicleScope(caller);

  const filters: Prisma.AssignmentWhereInput[] = [{ vehicle: scope }];
  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.driverId) filters.push({ driverId: query.driverId });
  if (query.open !== undefined) {
    filters.push(query.open ? { endDate: null } : { endDate: { not: null } });
  }

  const where: Prisma.AssignmentWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      select: ASSIGNMENT_SELECT,
      // Open assignments first, then most recent — the order a handover log
      // is read in.
      orderBy: [{ endDate: { sort: 'asc', nulls: 'first' } }, { startDate: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.assignment.count({ where }),
  ]);

  return { data: rows.map(toAssignment), page: query.page, pageSize: query.pageSize, total };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Assigns a vehicle, closing whatever assignment it currently has.
 *
 * The close and the open happen in one transaction. Done as two requests, a
 * failure between them leaves the vehicle either held by nobody or — if the
 * order were reversed — rejected by the unique index with the previous
 * assignment already closed. Neither is a state anyone should have to repair
 * by hand.
 */
export async function create(
  input: CreateAssignmentRequest,
  caller: CallerScope,
  actorId: string,
): Promise<Assignment> {
  const startDate = toDate(input.startDate) ?? today();

  const scope = await vehicleScope(caller);
  const vehicle = await prisma.vehicle.findFirst({
    where: { AND: [scope, { id: input.vehicleId }] },
    select: { id: true, status: true, plate: true },
  });
  if (!vehicle) throw new NotFoundError('Vehicle');

  if (vehicle.status === 'ARCHIVED') {
    throw new ConflictError('This vehicle is archived. Restore it before assigning a driver.');
  }

  const driver = await prisma.driver.findUnique({
    where: { id: input.driverId },
    select: { id: true, status: true, firstName: true, lastName: true },
  });
  if (!driver) {
    throw new ValidationError([{ path: 'body.driverId', message: 'No such driver.' }]);
  }
  if (driver.status === 'INACTIVE') {
    throw new ConflictError('That driver is inactive. Reactivate them before assigning a vehicle.');
  }

  const open = await prisma.assignment.findFirst({
    where: { vehicleId: input.vehicleId, endDate: null },
    select: { id: true, driverId: true, startDate: true },
  });

  if (open) {
    if (open.driverId === input.driverId) {
      throw new ConflictError('That driver already holds this vehicle.');
    }
    if (!input.closeExisting) {
      throw new ConflictError(
        'This vehicle is already assigned. End the current assignment first, or allow it to be closed automatically.',
      );
    }
    if (open.startDate > startDate) {
      // Closing an assignment before it began would violate the database's
      // own date-ordering CHECK, and would mean a handover that predates the
      // handover it replaces.
      throw new ValidationError([
        {
          path: 'body.startDate',
          message: `The current assignment began on ${dateOnly(open.startDate)}. The new one cannot start earlier.`,
        },
      ]);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    if (open) {
      // The handover day closes the previous period: DRV-03's "reassigning
      // closes the previous assignment rather than overwriting it".
      await tx.assignment.update({
        where: { id: open.id },
        data: { endDate: startDate, endedById: actorId },
      });
    }

    return tx.assignment.create({
      data: { vehicleId: input.vehicleId, driverId: input.driverId, startDate },
      select: ASSIGNMENT_SELECT,
    });
  });

  log.info(
    { vehicleId: input.vehicleId, driverId: input.driverId, closedPrevious: Boolean(open) },
    'Vehicle assigned',
  );

  return toAssignment(created);
}

export async function close(
  id: string,
  input: CloseAssignmentRequest,
  caller: CallerScope,
  actorId: string,
): Promise<Assignment> {
  const scope = await vehicleScope(caller);
  const existing = await prisma.assignment.findFirst({
    where: { AND: [{ vehicle: scope }, { id }] },
    select: { id: true, endDate: true, startDate: true },
  });
  if (!existing) throw new NotFoundError('Assignment');

  if (existing.endDate) {
    throw new ConflictError('That assignment has already ended.');
  }

  const endDate = toDate(input.endDate) ?? today();
  if (endDate < existing.startDate) {
    throw new ValidationError([
      {
        path: 'body.endDate',
        message: `The assignment began on ${dateOnly(existing.startDate)}; it cannot end before that.`,
      },
    ]);
  }

  const updated = await prisma.assignment.update({
    where: { id },
    data: { endDate, endedById: actorId },
    select: ASSIGNMENT_SELECT,
  });

  log.info({ assignmentId: id }, 'Assignment closed');
  return toAssignment(updated);
}
