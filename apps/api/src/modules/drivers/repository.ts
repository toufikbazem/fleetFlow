/**
 * Driver persistence — FF-303.
 *
 * Reads take a `CallerScope` rather than an optional filter: the Driver role is
 * limited to its own record (PRD §2.1, `R_SELF`), and making the scope a
 * required argument means a new query cannot be written without deciding how
 * far it reaches.
 */

import type { Driver, DriverListQuery } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { driverScope, type CallerScope } from '../../platform/scope.js';

const DRIVER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  licenceNo: true,
  licenceCategory: true,
  licenceExpiry: true,
  phone: true,
  hiredAt: true,
  status: true,
  userId: true,
  createdAt: true,
  user: { select: { email: true, deletedAt: true } },
  assignments: {
    // Open assignments only — a closed one is history (DRV-03), not a current
    // holding, and showing it would misreport who has the vehicle today.
    where: { endDate: null },
    select: {
      startDate: true,
      vehicle: { select: { id: true, plate: true, make: true, model: true } },
    },
    orderBy: { startDate: 'desc' },
  },
} as const;

type DriverRow = Prisma.DriverGetPayload<{ select: typeof DRIVER_SELECT }>;

function toIsoDate(value: Date | null): string | null {
  // Date-only columns carry no meaningful time; trimming avoids implying one.
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

export function toDriver(row: DriverRow): Driver {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    licenceNo: row.licenceNo,
    licenceCategory: row.licenceCategory,
    licenceExpiry: toIsoDate(row.licenceExpiry),
    phone: row.phone,
    hiredAt: toIsoDate(row.hiredAt),
    status: row.status,
    // A soft-deleted account must not keep appearing as this driver's login;
    // the relation is to-one, which the soft-delete extension cannot filter.
    userId: row.user && row.user.deletedAt === null ? row.userId : null,
    userEmail: row.user && row.user.deletedAt === null ? row.user.email : null,
    currentAssignments: row.assignments.map((assignment) => ({
      vehicleId: assignment.vehicle.id,
      plate: assignment.vehicle.plate,
      make: assignment.vehicle.make,
      model: assignment.vehicle.model,
      startDate: toIsoDate(assignment.startDate) ?? '',
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

function buildOrderBy(sort: string | undefined): Prisma.DriverOrderByWithRelationInput[] {
  const [field, direction] = (sort ?? 'lastName:asc').split(':');
  const order = direction === 'desc' ? 'desc' : 'asc';

  // Allowlisted — an arbitrary field from the query string never reaches Prisma.
  switch (field) {
    case 'firstName':
      return [{ firstName: order }, { lastName: order }];
    case 'licenceExpiry':
      return [{ licenceExpiry: order }];
    case 'createdAt':
      return [{ createdAt: order }];
    case 'lastName':
    default:
      return [{ lastName: order }, { firstName: order }];
  }
}

async function buildWhere(
  query: DriverListQuery,
  caller: CallerScope,
): Promise<Prisma.DriverWhereInput> {
  const filters: Prisma.DriverWhereInput[] = [await driverScope(caller)];

  if (query.status) filters.push({ status: query.status });

  if (query.licenceExpiringBefore) {
    filters.push({ licenceExpiry: { lte: new Date(query.licenceExpiringBefore) } });
  }

  if (query.hasVehicle !== undefined) {
    filters.push(
      query.hasVehicle
        ? { assignments: { some: { endDate: null } } }
        : { assignments: { none: { endDate: null } } },
    );
  }

  if (query.q) {
    filters.push({
      OR: [
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { licenceNo: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  // AND, so the caller's scope can never be widened by a filter — only narrowed.
  return { AND: filters };
}

export async function listDrivers(
  query: DriverListQuery,
  caller: CallerScope,
): Promise<{ rows: Driver[]; total: number }> {
  const where = await buildWhere(query, caller);

  const [rows, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      select: DRIVER_SELECT,
      orderBy: buildOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.driver.count({ where }),
  ]);

  return { rows: rows.map(toDriver), total };
}

/**
 * Scoped lookup: a Driver requesting somebody else's record gets null, and the
 * caller turns that into 404 rather than 403 — the existence of another
 * driver's record is itself information they do not have.
 */
export async function findDriverById(id: string, caller: CallerScope): Promise<Driver | null> {
  const scope = await driverScope(caller);
  const row = await prisma.driver.findFirst({
    where: { AND: [scope, { id }] },
    select: DRIVER_SELECT,
  });
  return row ? toDriver(row) : null;
}

export async function createDriver(data: Prisma.DriverCreateInput): Promise<Driver> {
  const row = await prisma.driver.create({ data, select: DRIVER_SELECT });
  return toDriver(row);
}

export async function updateDriver(id: string, data: Prisma.DriverUpdateInput): Promise<Driver> {
  const row = await prisma.driver.update({ where: { id }, data, select: DRIVER_SELECT });
  return toDriver(row);
}

export async function softDeleteDriver(id: string): Promise<void> {
  await prisma.driver.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'INACTIVE' },
  });
}

/** Open assignments block deletion — see the service for why. */
export async function countOpenAssignments(driverId: string): Promise<number> {
  return prisma.assignment.count({ where: { driverId, endDate: null } });
}
