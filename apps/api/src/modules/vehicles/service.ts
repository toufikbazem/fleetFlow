/**
 * Vehicle management — FF-401, FF-403, FF-405.
 */

import {
  canTransitionVehicle,
  humaniseVehicleStatus,
  type ChangeVehicleStatusRequest,
  type CreateVehicleRequest,
  type MileageReading,
  type Paginated,
  type RecordMileageRequest,
  type UpdateVehicleRequest,
  type Vehicle,
  type VehicleListQuery,
  type VehicleOverview,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import type { CallerScope } from '../../platform/scope.js';
import {
  countOpenAssignments,
  createVehicle,
  findVehicleById,
  listMileage,
  listVehicles,
  loadOverview,
  recordMileage,
  softDeleteVehicle,
  updateVehicle,
} from './repository.js';

const log = childLogger('vehicles');

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

async function requireVehicle(id: string, caller: CallerScope): Promise<Vehicle> {
  const vehicle = await findVehicleById(id, caller);
  // Out of scope and non-existent answer identically: a driver must not learn
  // that another vehicle exists by probing ids.
  if (!vehicle) throw new NotFoundError('Vehicle');
  return vehicle;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(
  query: VehicleListQuery,
  caller: CallerScope,
): Promise<Paginated<Vehicle>> {
  const { rows, total } = await listVehicles(query, caller);
  return { data: rows, page: query.page, pageSize: query.pageSize, total };
}

export async function getById(id: string, caller: CallerScope): Promise<Vehicle> {
  return requireVehicle(id, caller);
}

export async function getOverview(id: string, caller: CallerScope): Promise<VehicleOverview> {
  return loadOverview(await requireVehicle(id, caller));
}

export async function getMileage(
  id: string,
  caller: CallerScope,
  page: number,
  pageSize: number,
): Promise<Paginated<MileageReading>> {
  await requireVehicle(id, caller);
  const { rows, total } = await listMileage(id, page, pageSize);
  return { data: rows, page, pageSize, total };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function create(input: CreateVehicleRequest, createdById: string): Promise<Vehicle> {
  const vehicle = await createVehicle({
    plate: input.plate,
    vin: input.vin ?? null,
    make: input.make,
    model: input.model,
    year: input.year ?? null,
    currentMileage: input.currentMileage,
    purchaseDate: toDate(input.purchaseDate) ?? null,
    purchasePrice: input.purchasePrice ? new Prisma.Decimal(input.purchasePrice) : null,
    insuranceValue: input.insuranceValue ? new Prisma.Decimal(input.insuranceValue) : null,
    notes: input.notes ?? null,
    ...(input.vehicleTypeId ? { vehicleType: { connect: { id: input.vehicleTypeId } } } : {}),
  });

  // The opening odometer is history too: without this row the first real
  // reading would look like the vehicle's entire lifetime mileage, and the
  // mileage tab would start empty on a van with 84 000 km on it.
  if (input.currentMileage > 0) {
    await recordMileage({
      vehicleId: vehicle.id,
      mileage: input.currentMileage,
      note: 'Opening reading, recorded when the vehicle was added',
      recordedById: createdById,
      updateCurrent: false,
    });
  }

  log.info({ vehicleId: vehicle.id, plate: vehicle.plate }, 'Vehicle created');
  return vehicle;
}

export async function update(
  id: string,
  input: UpdateVehicleRequest,
  caller: CallerScope,
): Promise<Vehicle> {
  await requireVehicle(id, caller);

  return updateVehicle(id, {
    ...(input.plate !== undefined ? { plate: input.plate } : {}),
    ...(input.vin !== undefined ? { vin: input.vin } : {}),
    ...(input.make !== undefined ? { make: input.make } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.year !== undefined ? { year: input.year } : {}),
    ...(input.purchaseDate !== undefined ? { purchaseDate: toDate(input.purchaseDate) } : {}),
    ...(input.purchasePrice !== undefined
      ? { purchasePrice: new Prisma.Decimal(input.purchasePrice) }
      : {}),
    ...(input.insuranceValue !== undefined
      ? { insuranceValue: new Prisma.Decimal(input.insuranceValue) }
      : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.vehicleTypeId !== undefined
      ? { vehicleType: { connect: { id: input.vehicleTypeId } } }
      : {}),
  });
}

/**
 * VEH-06 lifecycle.
 *
 * Transitions are checked rather than assumed: going straight from ARCHIVED to
 * UNDER_MAINTENANCE would put a vehicle nobody operates into the workshop
 * queue, which is how a fleet ends up paying for a service on a van it sold.
 */
export async function changeStatus(
  id: string,
  input: ChangeVehicleStatusRequest,
  caller: CallerScope,
): Promise<Vehicle> {
  const vehicle = await requireVehicle(id, caller);

  if (!canTransitionVehicle(vehicle.status, input.status)) {
    throw new ConflictError(
      `A vehicle that is ${humaniseVehicleStatus(vehicle.status)} cannot become ${humaniseVehicleStatus(input.status)}.`,
    );
  }

  if (input.status === 'ARCHIVED' && vehicle.currentDriver) {
    // Archiving removes the vehicle from operational lists; leaving a driver
    // attached would make it invisible but still "held" by someone.
    throw new ConflictError('End the current driver assignment before archiving this vehicle.');
  }

  const updated = await updateVehicle(id, {
    status: input.status,
    // Kept as the archive timestamp so "archived when?" is answerable, and
    // cleared on return so the field never lies about a live vehicle.
    archivedAt: input.status === 'ARCHIVED' ? new Date() : null,
    ...(input.reason ? { notes: input.reason } : {}),
  });

  log.info({ vehicleId: id, from: vehicle.status, to: input.status }, 'Vehicle status changed');
  return updated;
}

/**
 * VEH-01 delete, under Q6 soft delete.
 *
 * Maintenance, documents and damages keep pointing at the row, so the cost
 * history stays reportable — the acceptance criterion asks for exactly that.
 * An open assignment blocks it for the same reason it blocks archiving.
 */
export async function remove(id: string, caller: CallerScope): Promise<void> {
  await requireVehicle(id, caller);

  if ((await countOpenAssignments(id)) > 0) {
    throw new ConflictError('End the current driver assignment before deleting this vehicle.');
  }

  await softDeleteVehicle(id);
  log.info({ vehicleId: id }, 'Vehicle deleted');
}

/**
 * VEH-05.
 *
 * Mileage drives maintenance triggers (MNT-02), so a wrong reading does not
 * merely look wrong — it can schedule or skip a service. A reading below the
 * current value is refused unless it is explicitly flagged as a correction,
 * and a correction never raises the vehicle's current value.
 */
export async function addMileage(
  id: string,
  input: RecordMileageRequest,
  caller: CallerScope,
  recordedById: string,
): Promise<MileageReading> {
  const vehicle = await requireVehicle(id, caller);

  if (input.mileage < vehicle.currentMileage && !input.isCorrection) {
    throw new ValidationError(
      [
        {
          path: 'body.mileage',
          message: `The last recorded reading is ${vehicle.currentMileage} km. Tick "correction" if the odometer was replaced or the previous entry was wrong.`,
        },
      ],
      'That reading is lower than the last one.',
    );
  }

  const reading = await recordMileage({
    vehicleId: id,
    mileage: input.mileage,
    note: input.note ?? null,
    recordedById,
    updateCurrent: input.mileage >= vehicle.currentMileage,
  });

  log.info(
    { vehicleId: id, mileage: input.mileage, correction: input.isCorrection },
    'Mileage recorded',
  );
  return reading;
}
