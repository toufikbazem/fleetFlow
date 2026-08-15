/**
 * Vehicles, mileage and assignments — FF-1201 (VEH-01…06, DRV-02, DRV-03, Q5).
 *
 * Two things here are load-bearing beyond CRUD, and both are invariants the
 * database enforces rather than the service:
 *
 *   Q5     one open assignment per vehicle, held by a partial unique index. A
 *          read-then-write check is a race two concurrent requests both pass.
 *   VEH-05 a mileage reading is what makes mileage-triggered maintenance fire,
 *          so it must move the odometer and must not move it backwards.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SEED,
  setupHarness,
  teardownHarness,
  unique,
  type Harness,
} from '../../testing/harness.js';

const API = '/api/v1';
let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await teardownHarness(h);
});

/**
 * A syntactically valid VIN.
 *
 * I, O and Q are excluded from the VIN alphabet to avoid confusion with 1 and 0,
 * and the schema enforces exactly 17 characters — so a random string with
 * hyphens in it is rejected, which is correct and was worth finding here.
 */
const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function vin(): string {
  return Array.from(
    { length: 17 },
    () => VIN_ALPHABET[Math.floor(Math.random() * VIN_ALPHABET.length)],
  ).join('');
}

/** Creates a vehicle and registers it for teardown. */
async function createVehicle(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(h.app)
    .post(`${API}/vehicles`)
    .set(h.auth('FLEET_MANAGER'))
    .send({
      plate: unique('TEST').toUpperCase().slice(0, 20),
      vin: vin(),
      make: 'Renault',
      model: 'Master',
      year: 2024,
      vehicleTypeId: SEED.vehicleType.van,
      currentMileage: 10_000,
      ...overrides,
    });
  expect(response.status).toBe(201);
  h.track('vehicle', response.body.vehicle.id);
  return response.body.vehicle.id as string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('GET /vehicles', () => {
  it('paginates', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles?page=1&pageSize=2`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.total).toBeGreaterThanOrEqual(4);
  });

  it('hides archived vehicles by default and reveals them on request', async () => {
    const operational = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));
    const withArchived = await request(h.app)
      .get(`${API}/vehicles?includeArchived=true`)
      .set(h.auth('ADMIN'));

    const ids = (list: { body: { data: Array<{ id: string }> } }): string[] =>
      list.body.data.map((row) => row.id);

    expect(ids(operational)).not.toContain(SEED.vehicle.archived);
    expect(ids(withArchived)).toContain(SEED.vehicle.archived);
  });

  it('filters by status', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles?status=UNDER_MAINTENANCE`)
      .set(h.auth('ADMIN'));
    expect(
      response.body.data.every((v: { status: string }) => v.status === 'UNDER_MAINTENANCE'),
    ).toBe(true);
  });

  it('searches by plate', async () => {
    const all = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));
    const plate = all.body.data[0].plate as string;
    const found = await request(h.app)
      .get(`${API}/vehicles?q=${encodeURIComponent(plate.slice(0, 4))}`)
      .set(h.auth('ADMIN'));
    expect(found.body.total).toBeGreaterThanOrEqual(1);
  });

  it('scopes a driver to their own vehicle', async () => {
    // The single most important row-level rule in the product: a Driver is
    // allowed to read vehicles, and must be handed exactly one.
    const response = await request(h.app).get(`${API}/vehicles`).set(h.auth('DRIVER'));
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].id).toBe(SEED.vehicle.van1);
  });

  it('refuses a driver another vehicle by id, as 404 not 403', async () => {
    // 404: confirming the id exists would leak the fleet's shape one probe at
    // a time. The module-level 403 is asserted by the matrix suite.
    const response = await request(h.app)
      .get(`${API}/vehicles/${SEED.vehicle.truck1}`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });
});

describe('GET /vehicles/:id/overview — VEH-02', () => {
  it('returns all four aggregate sections in one request', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles/${SEED.vehicle.van1}/overview`)
      .set(h.auth('FLEET_MANAGER'));
    expect(response.status).toBe(200);
    // VEH-02's acceptance is explicitly "loads all four aggregate sections
    // without a separate navigation step", so the shape *is* the requirement.
    expect(response.body).toHaveProperty('vehicle');
    expect(response.body).toHaveProperty('driverHistory');
    expect(response.body).toHaveProperty('upcomingMaintenance');
    expect(response.body).toHaveProperty('maintenanceHistory');
    expect(response.body).toHaveProperty('documents');
    expect(response.body.totals).toMatchObject({
      maintenanceCost: expect.any(String),
      completedJobs: expect.any(Number),
      openJobs: expect.any(Number),
    });
  });

  it('404s for an unknown id', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles/00000000-0000-4000-8000-999999999999/overview`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(404);
  });

  it('422s for a malformed id', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles/not-a-uuid/overview`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(422);
  });
});

describe('GET /vehicle-types', () => {
  it('lists the reference data', async () => {
    const response = await request(h.app).get(`${API}/vehicle-types`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe('POST /vehicles — VEH-01', () => {
  it('creates', async () => {
    const id = await createVehicle();
    const response = await request(h.app).get(`${API}/vehicles/${id}`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.vehicle.status).toBe('ACTIVE');
  });

  it('rejects a duplicate plate', async () => {
    const plate = unique('DUP').toUpperCase().slice(0, 20);
    await createVehicle({ plate });
    const second = await request(h.app).post(`${API}/vehicles`).set(h.auth('FLEET_MANAGER')).send({
      plate,
      vin: vin(),
      make: 'X',
      model: 'Y',
      year: 2024,
      vehicleTypeId: SEED.vehicleType.van,
      currentMileage: 0,
    });
    expect(second.status).toBe(409);
  });

  it('rejects a missing plate with a field-level error', async () => {
    const response = await request(h.app)
      .post(`${API}/vehicles`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ make: 'X', model: 'Y', year: 2024, vehicleTypeId: SEED.vehicleType.van });
    expect(response.status).toBe(422);
    expect(
      response.body.error.details.some((d: { path: string }) => d.path.includes('plate')),
    ).toBe(true);
  });

  it('rejects an unknown vehicle type', async () => {
    const response = await request(h.app)
      .post(`${API}/vehicles`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        plate: unique('T').toUpperCase().slice(0, 20),
        vin: vin(),
        make: 'X',
        model: 'Y',
        year: 2024,
        vehicleTypeId: '00000000-0000-4000-8000-999999999999',
        currentMileage: 0,
      });
    expect([404, 422]).toContain(response.status);
  });
});

describe('PATCH /vehicles/:id', () => {
  it('updates', async () => {
    const id = await createVehicle();
    const response = await request(h.app)
      .patch(`${API}/vehicles/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ model: 'Master L3H2' });
    expect(response.status).toBe(200);
    expect(response.body.vehicle.model).toBe('Master L3H2');
  });

  it('does not let a PATCH change the status', async () => {
    // VEH-06 has a transition table; a status set through the generic update
    // path would bypass it entirely.
    const id = await createVehicle();
    const response = await request(h.app)
      .patch(`${API}/vehicles/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'ARCHIVED' });
    const after = await request(h.app).get(`${API}/vehicles/${id}`).set(h.auth('ADMIN'));
    expect(after.body.vehicle.status).toBe('ACTIVE');
    expect([200, 422]).toContain(response.status);
  });
});

describe('POST /vehicles/:id/status — VEH-06', () => {
  it('follows the transition table', async () => {
    const id = await createVehicle();

    const toWorkshop = await request(h.app)
      .post(`${API}/vehicles/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'UNDER_MAINTENANCE' });
    expect(toWorkshop.status).toBe(200);

    const archive = await request(h.app)
      .post(`${API}/vehicles/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'ARCHIVED' });
    expect(archive.status).toBe(200);
  });

  it('refuses an illegal transition', async () => {
    const id = await createVehicle();
    await request(h.app)
      .post(`${API}/vehicles/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'ARCHIVED' });

    // ARCHIVED → UNDER_MAINTENANCE is not a real move: a vehicle comes back
    // into service before it goes into the workshop.
    const illegal = await request(h.app)
      .post(`${API}/vehicles/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'UNDER_MAINTENANCE' });
    expect(illegal.status).toBe(409);
  });
});

describe('DELETE /vehicles/:id — Q6 soft delete', () => {
  it('hides the vehicle but keeps the row', async () => {
    const id = await createVehicle();
    const deleted = await request(h.app).delete(`${API}/vehicles/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);

    const after = await request(h.app).get(`${API}/vehicles/${id}`).set(h.auth('ADMIN'));
    expect(after.status).toBe(404);

    const list = await request(h.app)
      .get(`${API}/vehicles?includeArchived=true&pageSize=100`)
      .set(h.auth('ADMIN'));
    expect(list.body.data.map((v: { id: string }) => v.id)).not.toContain(id);
  });
});

// ---------------------------------------------------------------------------
// Mileage — VEH-05
// ---------------------------------------------------------------------------

describe('vehicle mileage', () => {
  it('records a reading and moves the odometer', async () => {
    const id = await createVehicle({ currentMileage: 10_000 });

    const created = await request(h.app)
      .post(`${API}/vehicles/${id}/mileage`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mileage: 12_500, recordedAt: '2026-08-14' });
    expect(created.status).toBe(201);

    const vehicle = await request(h.app).get(`${API}/vehicles/${id}`).set(h.auth('ADMIN'));
    expect(vehicle.body.vehicle.currentMileage).toBe(12_500);
  });

  it('refuses a reading below the current odometer', async () => {
    // An odometer does not run backwards. Accepting one would silently reset
    // every mileage-triggered plan on the vehicle.
    const id = await createVehicle({ currentMileage: 50_000 });
    const response = await request(h.app)
      .post(`${API}/vehicles/${id}/mileage`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mileage: 49_000, recordedAt: '2026-08-14' });
    expect([409, 422]).toContain(response.status);
  });

  it('lists the history newest first', async () => {
    const id = await createVehicle({ currentMileage: 1000 });
    await request(h.app)
      .post(`${API}/vehicles/${id}/mileage`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mileage: 2000, recordedAt: '2026-08-10' });
    await request(h.app)
      .post(`${API}/vehicles/${id}/mileage`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mileage: 3000, recordedAt: '2026-08-14' });

    const response = await request(h.app).get(`${API}/vehicles/${id}/mileage`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.data[0].mileage).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Assignments — DRV-02, DRV-03, Q5
// ---------------------------------------------------------------------------

describe('assignments', () => {
  it('lists history including closed rows — DRV-03', async () => {
    const response = await request(h.app)
      .get(`${API}/assignments?vehicleId=${SEED.vehicle.van1}`)
      .set(h.auth('FLEET_MANAGER'));
    expect(response.status).toBe(200);
    // The seed has one open and one closed assignment on this vehicle;
    // reassignment must close a row rather than overwrite it.
    expect(response.body.total).toBeGreaterThanOrEqual(2);
    expect(response.body.data.some((a: { endDate: string | null }) => a.endDate !== null)).toBe(
      true,
    );
  });

  /**
   * Q5 — one driver per vehicle.
   *
   * `closeExisting: false` is the caller saying "tell me, do not perform the
   * handover for me". Nothing seeded is touched here: the whole point of the
   * assertion is that the request is refused.
   */
  it('refuses a second open assignment when told not to close the first', async () => {
    const response = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        vehicleId: SEED.vehicle.van1,
        driverId: SEED.driver.unlinked,
        startDate: '2026-08-14',
        closeExisting: false,
      });
    expect(response.status).toBe(409);
  });

  it('refuses to hand a vehicle to the driver who already holds it', async () => {
    const response = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        vehicleId: SEED.vehicle.van1,
        driverId: SEED.driver.amina,
        startDate: '2026-08-14',
      });
    expect(response.status).toBe(409);
  });

  /**
   * DRV-03 — reassignment closes rather than overwrites.
   *
   * Run against a vehicle this suite created, never a seeded one: the default
   * `closeExisting: true` performs a real handover, and doing that to seeded
   * data would change what every later suite reads.
   */
  it('closes the previous assignment on reassignment, keeping the history', async () => {
    const vehicleId = await createVehicle();

    const first = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId, driverId: SEED.driver.unlinked, startDate: '2026-08-01' });
    expect(first.status).toBe(201);
    h.track('assignment', first.body.assignment.id);

    const second = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId, driverId: SEED.driver.amina, startDate: '2026-08-11' });
    expect(second.status).toBe(201);
    h.track('assignment', second.body.assignment.id);

    const history = await request(h.app)
      .get(`${API}/assignments?vehicleId=${vehicleId}`)
      .set(h.auth('FLEET_MANAGER'));
    expect(history.body.total).toBe(2);

    const open = history.body.data.filter((a: { endDate: string | null }) => a.endDate === null);
    // Exactly one open row, which is Q5 stated as an observable outcome.
    expect(open).toHaveLength(1);
    expect(open[0].driverId).toBe(SEED.driver.amina);
  });

  it('refuses a handover that starts before the assignment it replaces', async () => {
    const vehicleId = await createVehicle();
    const first = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId, driverId: SEED.driver.unlinked, startDate: '2026-08-10' });
    h.track('assignment', first.body.assignment.id);

    const backdated = await request(h.app)
      .post(`${API}/assignments`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId, driverId: SEED.driver.amina, startDate: '2026-08-01' });
    expect(backdated.status).toBe(422);
  });

  it('refuses to close an already closed assignment', async () => {
    const response = await request(h.app)
      .patch(`${API}/assignments/${SEED.assignment.van1Closed}/close`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ endDate: '2026-08-14' });
    expect(response.status).toBe(409);
  });
});
