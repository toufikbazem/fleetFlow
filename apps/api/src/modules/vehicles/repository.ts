/**
 * Vehicle persistence — FF-401, FF-402, FF-403, FF-405.
 */

import {
  OPERATIONAL_VEHICLE_STATUSES,
  daysUntil,
  deriveDocumentStatus,
  type MileageReading,
  type Vehicle,
  type VehicleListQuery,
  type VehicleOverview,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { vehicleScope, type CallerScope } from '../../platform/scope.js';

const VEHICLE_SELECT = {
  id: true,
  plate: true,
  vin: true,
  make: true,
  model: true,
  year: true,
  vehicleTypeId: true,
  status: true,
  currentMileage: true,
  purchaseDate: true,
  purchasePrice: true,
  insuranceValue: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  vehicleType: { select: { name: true } },
  assignments: {
    // Q5 guarantees at most one, but `take` makes that explicit at the query.
    where: { endDate: null },
    take: 1,
    select: {
      id: true,
      startDate: true,
      driver: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
    },
  },
} as const;

type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof VEHICLE_SELECT }>;

function dateOnly(value: Date | null): string | null {
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

function money(value: Prisma.Decimal | null): string | null {
  // Decimal → string, never through a JS number: 0.1 + 0.2 has no place in a
  // column an accountant reconciles.
  return value === null ? null : value.toFixed(2);
}

export function toVehicle(row: VehicleRow): Vehicle {
  const open = row.assignments[0];
  // A soft-deleted driver must not keep appearing as the current holder; the
  // relation is to-one inside a list, so the extension does not filter it.
  const driver = open && open.driver.deletedAt === null ? open : undefined;

  return {
    id: row.id,
    plate: row.plate,
    vin: row.vin,
    make: row.make,
    model: row.model,
    year: row.year,
    vehicleTypeId: row.vehicleTypeId,
    vehicleTypeName: row.vehicleType?.name ?? null,
    status: row.status,
    currentMileage: row.currentMileage,
    purchaseDate: dateOnly(row.purchaseDate),
    purchasePrice: money(row.purchasePrice),
    insuranceValue: money(row.insuranceValue),
    notes: row.notes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    currentDriver: driver
      ? {
          driverId: driver.driver.id,
          firstName: driver.driver.firstName,
          lastName: driver.driver.lastName,
          assignmentId: driver.id,
          startDate: dateOnly(driver.startDate) ?? '',
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildOrderBy(sort: string | undefined): Prisma.VehicleOrderByWithRelationInput {
  const [field, direction] = (sort ?? 'plate:asc').split(':');
  const order = direction === 'desc' ? 'desc' : 'asc';

  switch (field) {
    case 'make':
      return { make: order };
    case 'year':
      return { year: order };
    case 'currentMileage':
      return { currentMileage: order };
    case 'status':
      return { status: order };
    case 'createdAt':
      return { createdAt: order };
    case 'plate':
    default:
      return { plate: order };
  }
}

async function buildWhere(
  query: VehicleListQuery,
  caller: CallerScope,
): Promise<Prisma.VehicleWhereInput> {
  const filters: Prisma.VehicleWhereInput[] = [await vehicleScope(caller)];

  if (query.status) {
    filters.push({ status: query.status });
  } else if (!query.includeArchived) {
    // VEH-06: archived vehicles leave the operational list but stay in reports.
    filters.push({ status: { in: [...OPERATIONAL_VEHICLE_STATUSES] } });
  }

  if (query.vehicleTypeId) filters.push({ vehicleTypeId: query.vehicleTypeId });
  if (query.driverId)
    filters.push({ assignments: { some: { driverId: query.driverId, endDate: null } } });
  if (query.unassigned !== undefined) {
    filters.push(
      query.unassigned
        ? { assignments: { none: { endDate: null } } }
        : { assignments: { some: { endDate: null } } },
    );
  }

  if (query.q) {
    filters.push({
      OR: [
        { plate: { contains: query.q, mode: 'insensitive' } },
        { vin: { contains: query.q, mode: 'insensitive' } },
        { make: { contains: query.q, mode: 'insensitive' } },
        { model: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  // AND: a filter can only narrow the caller's scope, never widen it.
  return { AND: filters };
}

export async function listVehicles(
  query: VehicleListQuery,
  caller: CallerScope,
): Promise<{ rows: Vehicle[]; total: number }> {
  const where = await buildWhere(query, caller);

  const [rows, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      select: VEHICLE_SELECT,
      orderBy: buildOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.vehicle.count({ where }),
  ]);

  return { rows: rows.map(toVehicle), total };
}

export async function findVehicleById(id: string, caller: CallerScope): Promise<Vehicle | null> {
  const scope = await vehicleScope(caller);
  const row = await prisma.vehicle.findFirst({
    where: { AND: [scope, { id }] },
    select: VEHICLE_SELECT,
  });
  return row ? toVehicle(row) : null;
}

export async function createVehicle(data: Prisma.VehicleCreateInput): Promise<Vehicle> {
  const row = await prisma.vehicle.create({ data, select: VEHICLE_SELECT });
  return toVehicle(row);
}

export async function updateVehicle(id: string, data: Prisma.VehicleUpdateInput): Promise<Vehicle> {
  const row = await prisma.vehicle.update({ where: { id }, data, select: VEHICLE_SELECT });
  return toVehicle(row);
}

export async function softDeleteVehicle(id: string): Promise<void> {
  await prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function countOpenAssignments(vehicleId: string): Promise<number> {
  return prisma.assignment.count({ where: { vehicleId, endDate: null } });
}

export async function listVehicleTypes() {
  const types = await prisma.vehicleType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
  return types;
}

// ---------------------------------------------------------------------------
// Mileage — VEH-05
// ---------------------------------------------------------------------------

const MILEAGE_SELECT = {
  id: true,
  mileage: true,
  recordedAt: true,
  source: true,
  note: true,
  recordedBy: { select: { name: true } },
} as const;

type MileageRow = Prisma.MileageReadingGetPayload<{ select: typeof MILEAGE_SELECT }>;

function toMileage(row: MileageRow): MileageReading {
  return {
    id: row.id,
    mileage: row.mileage,
    recordedAt: row.recordedAt.toISOString(),
    recordedByName: row.recordedBy?.name ?? null,
    source: row.source,
    note: row.note,
  };
}

export async function listMileage(
  vehicleId: string,
  page: number,
  pageSize: number,
): Promise<{ rows: MileageReading[]; total: number }> {
  const where = { vehicleId };
  const [rows, total] = await Promise.all([
    prisma.mileageReading.findMany({
      where,
      select: MILEAGE_SELECT,
      orderBy: { recordedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.mileageReading.count({ where }),
  ]);
  return { rows: rows.map(toMileage), total };
}

/**
 * Records a reading and updates the vehicle's denormalised current value.
 *
 * Both in one transaction: `mileage_readings` is the authoritative history and
 * `vehicles.current_mileage` is a copy kept for fast filtering. If they diverge,
 * the copy is what maintenance triggers read, so it must never be updated
 * without its source row — or the other way round.
 */
export async function recordMileage(input: {
  vehicleId: string;
  mileage: number;
  note: string | null;
  recordedById: string;
  /** A correction may lower the reading, so it must not raise the current value. */
  updateCurrent: boolean;
}): Promise<MileageReading> {
  const [reading] = await prisma.$transaction([
    prisma.mileageReading.create({
      data: {
        vehicleId: input.vehicleId,
        mileage: input.mileage,
        note: input.note,
        recordedById: input.recordedById,
        source: 'MANUAL',
      },
      select: MILEAGE_SELECT,
    }),
    ...(input.updateCurrent
      ? [
          prisma.vehicle.update({
            where: { id: input.vehicleId },
            data: { currentMileage: input.mileage },
          }),
        ]
      : []),
  ]);

  return toMileage(reading);
}

// ---------------------------------------------------------------------------
// Overview — VEH-02 / FF-405
// ---------------------------------------------------------------------------

/**
 * The whole detail page in one query set.
 *
 * Issued in parallel and assembled here rather than exposed as four endpoints:
 * the acceptance criterion is that the four sections load together, and four
 * round trips would also let the tabs disagree with each other by a few seconds.
 */
export async function loadOverview(vehicle: Vehicle): Promise<VehicleOverview> {
  const vehicleId = vehicle.id;

  const [assignments, maintenance, documents, mileage, openDamages] = await Promise.all([
    prisma.assignment.findMany({
      where: { vehicleId },
      orderBy: [{ endDate: { sort: 'asc', nulls: 'first' } }, { startDate: 'desc' }],
      select: {
        id: true,
        startDate: true,
        endDate: true,
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
    }),

    prisma.maintenanceOp.findMany({
      where: { vehicleId },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        dueMileage: true,
        completedAt: true,
        costTotal: true,
        currency: true,
        mechanic: { select: { name: true } },
      },
    }),

    prisma.document.findMany({
      where: { vehicleId },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        referenceNo: true,
        expiryDate: true,
        noticeDays: true,
        documentType: { select: { label: true, defaultNoticeDays: true } },
      },
    }),

    prisma.mileageReading.findMany({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
      take: 10,
      select: MILEAGE_SELECT,
    }),

    prisma.damage.count({
      where: { vehicleId, status: { in: ['REPORTED', 'UNDER_REVIEW', 'LINKED'] } },
    }),
  ]);

  const mapMaintenance = (row: (typeof maintenance)[number]) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    dueDate: dateOnly(row.dueDate),
    dueMileage: row.dueMileage,
    completedAt: row.completedAt?.toISOString() ?? null,
    costTotal: row.costTotal.toFixed(2),
    currency: row.currency,
    mechanicName: row.mechanic?.name ?? null,
  });

  const completed = maintenance.filter((op) => op.status === 'COMPLETED');
  const open = maintenance.filter((op) => op.status !== 'COMPLETED');

  const mappedDocuments = documents.map((doc) => {
    // A per-document override wins over the type's default (DOC-03).
    const noticeDays = doc.noticeDays ?? doc.documentType.defaultNoticeDays;
    return {
      id: doc.id,
      typeLabel: doc.documentType.label,
      referenceNo: doc.referenceNo,
      expiryDate: dateOnly(doc.expiryDate) ?? '',
      // Derived through the shared helper, so this agrees with every list and
      // badge elsewhere in the product.
      status: deriveDocumentStatus(doc.expiryDate, noticeDays),
      daysUntilExpiry: daysUntil(doc.expiryDate),
    };
  });

  const maintenanceCost = completed.reduce(
    (total, op) => total.add(op.costTotal),
    new Prisma.Decimal(0),
  );

  return {
    vehicle,
    driverHistory: assignments.map((assignment) => ({
      id: assignment.id,
      driverId: assignment.driver.id,
      driverName: `${assignment.driver.firstName} ${assignment.driver.lastName}`,
      startDate: dateOnly(assignment.startDate) ?? '',
      endDate: dateOnly(assignment.endDate),
    })),
    upcomingMaintenance: open.map(mapMaintenance),
    maintenanceHistory: completed.map(mapMaintenance),
    documents: mappedDocuments,
    recentMileage: mileage.map(toMileage),
    totals: {
      maintenanceCost: maintenanceCost.toFixed(2),
      completedJobs: completed.length,
      openJobs: open.length,
      expiringDocuments: mappedDocuments.filter((doc) => doc.status !== 'VALID').length,
      openDamages,
    },
  };
}
