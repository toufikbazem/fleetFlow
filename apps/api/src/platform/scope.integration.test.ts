/**
 * Row scoping against real data — FF-206.
 *
 * The matrix test proves a Driver may *read maintenance*. This proves they read
 * only their own vehicle's. That distinction is the difference between a
 * working permission system and a data breach with a green test suite.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, prisma, withDeleted } from './db.js';
import {
  canReachVehicle,
  currentVehicleIds,
  damageScope,
  documentScope,
  driverScope,
  maintenanceScope,
  vehicleScope,
  type CallerScope,
} from './scope.js';

const raw = withDeleted();

/** Fixed ids from prisma/seed.ts. */
const SEED = {
  driverAmina: '00000000-0000-4000-8000-000000000101',
  driverYoussef: '00000000-0000-4000-8000-000000000102',
  driverUnassigned: '00000000-0000-4000-8000-000000000103',
  userAmina: '00000000-0000-4000-8000-000000000005',
  userMechanic: '00000000-0000-4000-8000-000000000003',
  vehicleVan1: '00000000-0000-4000-8000-000000000301',
  vehicleTruck1: '00000000-0000-4000-8000-000000000303',
} as const;

const ADMIN: CallerScope = {
  role: 'ADMIN',
  userId: '00000000-0000-4000-8000-000000000001',
  driverId: null,
  scope: 'all',
};

const DRIVER: CallerScope = {
  role: 'DRIVER',
  userId: SEED.userAmina,
  driverId: SEED.driverAmina,
  scope: 'own_vehicle',
};

/** A DRIVER-role account that was never linked to a driver record. */
const ORPHAN_DRIVER: CallerScope = {
  role: 'DRIVER',
  userId: '00000000-0000-4000-8000-0000000000ff',
  driverId: null,
  scope: 'own_vehicle',
};

const MECHANIC: CallerScope = {
  role: 'MECHANIC',
  userId: SEED.userMechanic,
  driverId: null,
  scope: 'assigned',
};

beforeAll(async () => {
  // The suite reads seeded data; fail loudly rather than silently passing on an
  // empty database.
  const vehicles = await prisma.vehicle.count();
  if (vehicles === 0) throw new Error('Database is not seeded — run `npm run db:seed`');
});

afterAll(async () => {
  await disconnectDb();
});

describe('currentVehicleIds', () => {
  it('returns the vehicle a driver currently holds', async () => {
    expect(await currentVehicleIds(SEED.driverAmina)).toEqual([SEED.vehicleVan1]);
  });

  it('excludes assignments that have been closed', async () => {
    // Youssef held van1 historically and holds truck1 now (seed). Only the open
    // assignment counts — a vehicle handed back is history, not access.
    const ids = await currentVehicleIds(SEED.driverYoussef);
    expect(ids).toEqual([SEED.vehicleTruck1]);
    expect(ids).not.toContain(SEED.vehicleVan1);
  });

  it('returns nothing for a driver with no current vehicle', async () => {
    expect(await currentVehicleIds(SEED.driverUnassigned)).toEqual([]);
  });
});

describe('vehicle scope', () => {
  it('is unrestricted for an administrator', async () => {
    expect(await vehicleScope(ADMIN)).toEqual({});
  });

  it('restricts a driver to the vehicle they hold', async () => {
    const where = await vehicleScope(DRIVER);
    const visible = await prisma.vehicle.findMany({ where, select: { id: true } });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(SEED.vehicleVan1);

    // And the fleet is genuinely larger than what they can see.
    expect(await prisma.vehicle.count()).toBeGreaterThan(1);
  });

  it('shows nothing to a driver-role account with no driver record', async () => {
    const where = await vehicleScope(ORPHAN_DRIVER);
    expect(await prisma.vehicle.findMany({ where })).toHaveLength(0);
  });
});

describe('maintenance scope', () => {
  it('restricts a driver to their own vehicle’s jobs', async () => {
    const where = await maintenanceScope(DRIVER);
    const visible = await prisma.maintenanceOp.findMany({
      where,
      select: { vehicleId: true },
    });

    expect(visible.length).toBeGreaterThan(0);
    for (const op of visible) {
      expect(op.vehicleId).toBe(SEED.vehicleVan1);
    }

    expect(await prisma.maintenanceOp.count()).toBeGreaterThan(visible.length);
  });

  it('restricts a mechanic to the jobs assigned to them, across any vehicle', async () => {
    const where = await maintenanceScope(MECHANIC);
    const visible = await prisma.maintenanceOp.findMany({
      where,
      select: { mechanicId: true, vehicleId: true },
    });

    expect(visible.length).toBeGreaterThan(0);
    for (const op of visible) {
      expect(op.mechanicId).toBe(SEED.userMechanic);
    }

    // Not vehicle-scoped: a mechanic works across the fleet (MNT-07).
    expect(new Set(visible.map((op) => op.vehicleId)).size).toBeGreaterThan(1);

    // And they do not see the unassigned overdue job.
    const unassigned = await prisma.maintenanceOp.count({ where: { mechanicId: null } });
    expect(unassigned).toBeGreaterThan(0);
  });
});

describe('document and damage scope', () => {
  it('restricts a driver to their own vehicle’s documents', async () => {
    const visible = await prisma.document.findMany({
      where: await documentScope(DRIVER),
      select: { vehicleId: true },
    });

    expect(visible.length).toBeGreaterThan(0);
    for (const doc of visible) expect(doc.vehicleId).toBe(SEED.vehicleVan1);
    expect(await prisma.document.count()).toBeGreaterThan(visible.length);
  });

  it('restricts a driver to their own vehicle’s damages', async () => {
    const visible = await prisma.damage.findMany({
      where: await damageScope(DRIVER),
      select: { vehicleId: true },
    });

    for (const damage of visible) expect(damage.vehicleId).toBe(SEED.vehicleVan1);
  });
});

describe('driver scope', () => {
  it('restricts a driver to their own record', async () => {
    const visible = await prisma.driver.findMany({
      where: await driverScope({ ...DRIVER, scope: 'self' }),
      select: { id: true },
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(SEED.driverAmina);
    expect(await prisma.driver.count()).toBeGreaterThan(1);
  });

  it('shows nothing when the account has no driver record', async () => {
    const where = await driverScope({ ...ORPHAN_DRIVER, scope: 'self' });
    expect(await prisma.driver.findMany({ where })).toHaveLength(0);
  });
});

describe('mismatched scopes deny rather than guess', () => {
  it.each([
    ['vehicles', () => vehicleScope({ ...DRIVER, scope: 'assigned' })],
    ['drivers', () => driverScope({ ...DRIVER, scope: 'own_vehicle' })],
    ['maintenance', () => maintenanceScope({ ...DRIVER, scope: 'self' })],
    ['documents', () => documentScope({ ...DRIVER, scope: 'assigned' })],
    ['damages', () => damageScope({ ...DRIVER, scope: 'self' })],
  ] as const)('%s returns a filter matching nothing', async (_label, build) => {
    // A scope with no meaning for the module must never widen to everything.
    expect(await build()).toEqual({ id: { in: [] } });
  });
});

describe('canReachVehicle — for write paths that name a vehicle in the body', () => {
  it('lets an administrator reach any vehicle', async () => {
    expect(await canReachVehicle(ADMIN, SEED.vehicleTruck1)).toBe(true);
  });

  it('lets a driver reach only the vehicle they hold', async () => {
    expect(await canReachVehicle(DRIVER, SEED.vehicleVan1)).toBe(true);
    // DMG-03: a driver may report a problem on their vehicle, not on someone else's.
    expect(await canReachVehicle(DRIVER, SEED.vehicleTruck1)).toBe(false);
  });

  it('refuses an account with no driver record', async () => {
    expect(await canReachVehicle(ORPHAN_DRIVER, SEED.vehicleVan1)).toBe(false);
  });

  it('refuses a mechanic, whose scope is tasks and not vehicles', async () => {
    expect(await canReachVehicle(MECHANIC, SEED.vehicleVan1)).toBe(false);
  });
});

describe('scoping composes with soft delete', () => {
  it('hides a soft-deleted vehicle from its own driver', async () => {
    const probeId = 'dddddddd-0000-4000-8000-000000000001';
    const driverId = SEED.driverUnassigned;

    await raw.vehicle.create({
      data: { id: probeId, plate: 'SCOPE-TEST-1', make: 'Test', model: 'Probe' },
    });
    await raw.assignment.create({
      data: { vehicleId: probeId, driverId, startDate: new Date() },
    });

    const caller: CallerScope = {
      role: 'DRIVER',
      userId: 'unused',
      driverId,
      scope: 'own_vehicle',
    };

    expect(await prisma.vehicle.findMany({ where: await vehicleScope(caller) })).toHaveLength(1);

    await raw.vehicle.update({ where: { id: probeId }, data: { deletedAt: new Date() } });

    // The assignment still exists, so the scope still names the vehicle — but
    // the soft-delete extension removes it. Two independent filters, both applied.
    expect(await prisma.vehicle.findMany({ where: await vehicleScope(caller) })).toHaveLength(0);

    await raw.assignment.deleteMany({ where: { vehicleId: probeId } });
    await raw.vehicle.delete({ where: { id: probeId } });
  });
});
