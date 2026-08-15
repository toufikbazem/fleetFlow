/**
 * The reference dataset — FF-1204 (§7, Q2: 250 vehicles / 40 users).
 *
 * DSH's acceptance criterion is "the full view renders in under 2 seconds on
 * the reference dataset". That sentence is meaningless without the dataset, and
 * a demo seed of four vehicles will meet any target — including one met by
 * fetching every row and filtering in memory, which is precisely the shape this
 * is meant to expose.
 *
 * It is additive: it layers volume on top of `seed.ts` rather than replacing it,
 * so the fixed ids every integration suite depends on survive. Everything it
 * creates carries a recognisable prefix so it can be removed again.
 *
 *   npx tsx prisma/seed-reference.ts          # load
 *   npx tsx prisma/seed-reference.ts --clean  # remove
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Everything this script creates is findable by this marker. */
const MARKER = 'REF-';

const VEHICLES = 250;
const USERS = 40;
const DRIVERS = 120;
/** Roughly two years of history per vehicle on a quarterly cycle. */
const OPS_PER_VEHICLE = 8;
const DOCS_PER_VEHICLE = 3;
const MILEAGE_PER_VEHICLE = 6;

/** Deterministic pseudo-randomness: the same dataset every run, so timings compare. */
let seed = 20260814;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}
function between(min: number, max: number): number {
  return Math.floor(min + random() * (max - min));
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

const MAKES = ['Renault', 'Volvo', 'Mercedes', 'Iveco', 'Ford', 'MAN', 'Scania', 'Peugeot'];
const MODELS = ['Master', 'FL 250', 'Sprinter', 'Daily', 'Transit', 'TGL', 'P280', 'Boxer'];
const VENDORS = ['Garage Atlas', 'AutoPro', 'FleetCare', 'Nord Mécanique', 'Rapide Service'];

async function clean(): Promise<void> {
  console.log('Removing the reference dataset…');

  const vehicles = await prisma.vehicle.findMany({
    where: { plate: { startsWith: MARKER } },
    select: { id: true },
  });
  const vehicleIds = vehicles.map((v) => v.id);

  // Children first: a vehicle cannot go while an operation still points at it.
  await prisma.mileageReading.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.maintenanceOp.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.document.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.damage.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.assignment.deleteMany({ where: { vehicleId: { in: vehicleIds } } });
  await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  await prisma.driver.deleteMany({ where: { licenceNo: { startsWith: MARKER } } });
  await prisma.notification.deleteMany({
    where: { user: { email: { startsWith: MARKER.toLowerCase() } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARKER.toLowerCase() } } });

  console.log(`Removed ${vehicleIds.length} vehicles and everything hanging off them.`);
}

async function load(): Promise<void> {
  const started = Date.now();
  console.log(`Loading the reference dataset — ${VEHICLES} vehicles, ${USERS} users…`);

  const passwordHash = await bcrypt.hash('FleetFlow-Dev-2026!', 12);
  const types = await prisma.vehicleType.findMany({ select: { id: true } });
  if (types.length === 0) throw new Error('Run `npm run db:seed` first — no vehicle types exist.');
  const typeIds = types.map((t) => t.id);

  const docTypes = await prisma.documentType.findMany({ select: { id: true } });
  const docTypeIds = docTypes.map((t) => t.id);

  // --- users -------------------------------------------------------------
  const roles = ['FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'] as const;
  await prisma.user.createMany({
    data: Array.from({ length: USERS }, (_, index) => ({
      name: `Reference User ${index + 1}`,
      email: `${MARKER.toLowerCase()}user${index + 1}@fleetflow.test`,
      role: roles[index % roles.length] ?? 'DRIVER',
      passwordHash,
    })),
    skipDuplicates: true,
  });
  const mechanics = await prisma.user.findMany({
    where: { role: 'MECHANIC', email: { startsWith: MARKER.toLowerCase() } },
    select: { id: true },
  });
  const mechanicIds = mechanics.map((m) => m.id);

  // --- drivers -----------------------------------------------------------
  await prisma.driver.createMany({
    data: Array.from({ length: DRIVERS }, (_, index) => ({
      firstName: `Ref${index + 1}`,
      lastName: 'Driver',
      licenceNo: `${MARKER}DL-${index + 1}`,
      status: 'ACTIVE' as const,
    })),
    skipDuplicates: true,
  });
  const drivers = await prisma.driver.findMany({
    where: { licenceNo: { startsWith: MARKER } },
    select: { id: true },
  });

  // --- vehicles ----------------------------------------------------------
  await prisma.vehicle.createMany({
    data: Array.from({ length: VEHICLES }, (_, index) => ({
      plate: `${MARKER}${String(index + 1).padStart(4, '0')}`,
      make: pick(MAKES),
      model: pick(MODELS),
      year: between(2016, 2026),
      vehicleTypeId: pick(typeIds),
      // A spread of statuses, because the dashboard groups by it.
      status: index % 20 === 0 ? ('UNDER_MAINTENANCE' as const) : ('ACTIVE' as const),
      currentMileage: between(5_000, 400_000),
    })),
    skipDuplicates: true,
  });
  const vehicles = await prisma.vehicle.findMany({
    where: { plate: { startsWith: MARKER } },
    select: { id: true, currentMileage: true },
  });
  console.log(`  ${vehicles.length} vehicles`);

  // --- assignments -------------------------------------------------------
  // One open assignment each for the first `DRIVERS` vehicles: Q5's partial
  // unique index means one per vehicle, so this is the realistic maximum.
  await prisma.assignment.createMany({
    data: drivers.slice(0, Math.min(drivers.length, vehicles.length)).map((driver, index) => ({
      vehicleId: vehicles[index]?.id as string,
      driverId: driver.id,
      startDate: daysFromNow(-between(30, 700)),
    })),
    skipDuplicates: true,
  });

  // --- maintenance -------------------------------------------------------
  const ops: Array<Record<string, unknown>> = [];
  for (const vehicle of vehicles) {
    for (let index = 0; index < OPS_PER_VEHICLE; index += 1) {
      // Most of the history is completed; the tail is open work, some of it
      // overdue, so the dashboard's buckets all have something in them.
      const completed = index < OPS_PER_VEHICLE - 2;
      const parts = between(50, 900);
      const labour = between(30, 500);
      const completedAt = completed ? daysFromNow(-between(1, 720)) : null;
      const kind = index % 3 === 0 ? ('UNEXPECTED' as const) : ('SCHEDULED' as const);

      ops.push({
        vehicleId: vehicle.id,
        kind,
        title: `Reference service ${index + 1}`,
        status: completed ? 'COMPLETED' : 'PLANNED',
        // Scheduled work always carries a trigger, enforced by the
        // `maintenance_ops_scheduled_has_trigger` CHECK — a scheduled job with
        // neither a due date nor a due mileage would never appear in an
        // upcoming list and never become overdue. Completed rows keep the date
        // they were due on rather than losing it.
        dueDate:
          kind === 'SCHEDULED' || !completed
            ? daysFromNow(completed ? -between(1, 720) : between(-40, 60))
            : null,
        completedAt,
        completedMileage: completed ? vehicle.currentMileage - between(0, 40_000) : null,
        mechanicId: mechanicIds.length > 0 ? pick(mechanicIds) : null,
        costParts: parts,
        costLabour: labour,
        costTotal: parts + labour,
        currency: 'USD',
        vendor: pick(VENDORS),
      });
    }
  }
  // Chunked: one statement with 2 000 rows exceeds the parameter limit.
  for (let index = 0; index < ops.length; index += 500) {
    await prisma.maintenanceOp.createMany({ data: ops.slice(index, index + 500) as never });
  }
  console.log(`  ${ops.length} maintenance operations`);

  // --- documents ---------------------------------------------------------
  const documents: Array<Record<string, unknown>> = [];
  for (const vehicle of vehicles) {
    for (let index = 0; index < DOCS_PER_VEHICLE; index += 1) {
      documents.push({
        vehicleId: vehicle.id,
        documentTypeId: docTypeIds[index % docTypeIds.length] as string,
        // A spread across valid / expiring / expired, so DOC-05's CASE has
        // work to do rather than answering VALID for every row.
        expiryDate: daysFromNow(between(-60, 500)),
        referenceNo: `${MARKER}DOC-${vehicle.id.slice(0, 6)}-${index}`,
      });
    }
  }
  for (let index = 0; index < documents.length; index += 500) {
    await prisma.document.createMany({ data: documents.slice(index, index + 500) as never });
  }
  console.log(`  ${documents.length} documents`);

  // --- mileage -----------------------------------------------------------
  const readings: Array<Record<string, unknown>> = [];
  for (const vehicle of vehicles) {
    for (let index = 0; index < MILEAGE_PER_VEHICLE; index += 1) {
      readings.push({
        vehicleId: vehicle.id,
        // Clamped at zero: an odometer cannot be negative, and the
        // `mileage_readings_non_negative` CHECK says so.
        mileage: Math.max(0, vehicle.currentMileage - between(0, 60_000)),
        recordedAt: daysFromNow(-between(1, 700)),
        source: 'MANUAL' as const,
      });
    }
  }
  for (let index = 0; index < readings.length; index += 500) {
    await prisma.mileageReading.createMany({ data: readings.slice(index, index + 500) as never });
  }
  console.log(`  ${readings.length} mileage readings`);

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

const action = process.argv.includes('--clean') ? clean : load;
await action();
await prisma.$disconnect();
