/**
 * Driver management — FF-303 (DRV-01, DRV-04).
 */

import type {
  CreateDriverRequest,
  Driver,
  DriverListQuery,
  Paginated,
  UpdateDriverRequest,
} from '@fleetflow/shared';
import { prisma } from '../../platform/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import type { CallerScope } from '../../platform/scope.js';
import {
  countOpenAssignments,
  createDriver,
  findDriverById,
  listDrivers,
  softDeleteDriver,
  updateDriver,
} from './repository.js';

const log = childLogger('drivers');

/** `YYYY-MM-DD` from the wire becomes a date-only column value. */
function toDate(value: string | undefined | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * DRV-04. The link is optional, but when present it must be sound:
 *
 *   - the account must exist and not be deleted
 *   - it must hold the DRIVER role, or the driver scope resolved at login would
 *     not match what the matrix grants
 *   - it must not already belong to another driver — the column is unique, but
 *     failing here names the conflict instead of surfacing a raw 409
 */
async function assertUserLinkable(userId: string, exceptDriverId?: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, driver: { select: { id: true, deletedAt: true } } },
  });

  if (!user) {
    throw new ValidationError([{ path: 'body.userId', message: 'No such user account.' }]);
  }

  if (user.role !== 'DRIVER') {
    throw new ValidationError([
      {
        path: 'body.userId',
        message: 'Only an account with the Driver role can be linked to a driver record.',
      },
    ]);
  }

  const linked = user.driver;
  if (linked && linked.deletedAt === null && linked.id !== exceptDriverId) {
    throw new ConflictError('That account is already linked to another driver.');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(
  query: DriverListQuery,
  caller: CallerScope,
): Promise<Paginated<Driver>> {
  const { rows, total } = await listDrivers(query, caller);
  return { data: rows, page: query.page, pageSize: query.pageSize, total };
}

export async function getById(id: string, caller: CallerScope): Promise<Driver> {
  const driver = await findDriverById(id, caller);
  // Out of scope and non-existent are answered identically: a Driver asking for
  // a colleague's record must not learn that the record exists.
  if (!driver) throw new NotFoundError('Driver');
  return driver;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function create(input: CreateDriverRequest): Promise<Driver> {
  if (input.userId) await assertUserLinkable(input.userId);

  const driver = await createDriver({
    firstName: input.firstName,
    lastName: input.lastName,
    licenceNo: input.licenceNo,
    licenceCategory: input.licenceCategory ?? null,
    licenceExpiry: toDate(input.licenceExpiry) ?? null,
    phone: input.phone ?? null,
    hiredAt: toDate(input.hiredAt) ?? null,
    status: input.status,
    ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
  });

  log.info({ driverId: driver.id, linkedUser: input.userId ?? null }, 'Driver created');
  return driver;
}

export async function update(
  id: string,
  input: UpdateDriverRequest,
  caller: CallerScope,
): Promise<Driver> {
  // Scoped read first: the caller must be able to see the record before they
  // can change it, so an out-of-scope id is a 404 rather than a silent write.
  await getById(id, caller);

  if (input.userId) await assertUserLinkable(input.userId, id);

  const driver = await updateDriver(id, {
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    ...(input.licenceNo !== undefined ? { licenceNo: input.licenceNo } : {}),
    ...(input.licenceCategory !== undefined ? { licenceCategory: input.licenceCategory } : {}),
    ...(input.licenceExpiry !== undefined ? { licenceExpiry: toDate(input.licenceExpiry) } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.hiredAt !== undefined ? { hiredAt: toDate(input.hiredAt) } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    // null disconnects; undefined leaves the link untouched.
    ...(input.userId === null
      ? { user: { disconnect: true } }
      : input.userId
        ? { user: { connect: { id: input.userId } } }
        : {}),
  });

  return driver;
}

/**
 * DRV-01 delete, under Q6 soft delete.
 *
 * Blocked while the driver still holds a vehicle. The assignment history is the
 * source for VEH-03 and the driver-assignment report, and an open assignment
 * naming a deleted driver would make "who has this vehicle" unanswerable.
 * Closing the assignment is an explicit act, not a side effect of deletion.
 */
export async function remove(id: string, caller: CallerScope): Promise<void> {
  await getById(id, caller);

  const open = await countOpenAssignments(id);
  if (open > 0) {
    throw new ConflictError(
      open === 1
        ? 'This driver is still assigned to a vehicle. End the assignment first.'
        : `This driver is still assigned to ${open} vehicles. End those assignments first.`,
    );
  }

  await softDeleteDriver(id);
  log.info({ driverId: id }, 'Driver deleted');
}
