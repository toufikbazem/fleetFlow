/**
 * Maintenance, plans and the trigger engine — FF-1201 (MNT-01…07, DSH-04/05).
 *
 * The arithmetic is covered by `trigger-engine.test.ts`. What is covered here
 * is everything the arithmetic feeds: the status workflow, the cost invariant
 * the database pins, a mechanic's scoping, and — the one that matters most —
 * that running the engine twice does not produce the work twice.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, setupHarness, teardownHarness, type Harness } from '../../testing/harness.js';

const API = '/api/v1';
let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await teardownHarness(h);
});

async function createOp(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(h.app)
    .post(`${API}/maintenance`)
    .set(h.auth('FLEET_MANAGER'))
    .send({
      vehicleId: SEED.vehicle.van2,
      title: 'Integration test job',
      kind: 'UNEXPECTED',
      ...overrides,
    });
  expect(response.status).toBe(201);
  h.track('maintenanceOp', response.body.operation.id);
  return response.body.operation.id as string;
}

// ---------------------------------------------------------------------------
// Reads and filters
// ---------------------------------------------------------------------------

describe('GET /maintenance', () => {
  it('lists and paginates', async () => {
    const response = await request(h.app)
      .get(`${API}/maintenance?pageSize=2`)
      .set(h.auth('FLEET_MANAGER'));
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeLessThanOrEqual(2);
    expect(response.body.total).toBeGreaterThanOrEqual(4);
  });

  it('filters by status and by vehicle', async () => {
    const byStatus = await request(h.app)
      .get(`${API}/maintenance?status=COMPLETED`)
      .set(h.auth('ADMIN'));
    expect(byStatus.body.data.every((o: { status: string }) => o.status === 'COMPLETED')).toBe(
      true,
    );

    const byVehicle = await request(h.app)
      .get(`${API}/maintenance?vehicleId=${SEED.vehicle.van1}`)
      .set(h.auth('ADMIN'));
    expect(
      byVehicle.body.data.every((o: { vehicleId: string }) => o.vehicleId === SEED.vehicle.van1),
    ).toBe(true);
  });

  it('serves ?open=true as everything not completed', async () => {
    const response = await request(h.app).get(`${API}/maintenance?open=true`).set(h.auth('ADMIN'));
    expect(response.body.data.every((o: { status: string }) => o.status !== 'COMPLETED')).toBe(
      true,
    );
  });

  /**
   * The dashboard drill-through. `?due=` is not `?status=`: it also catches work
   * whose date or mileage has passed but which the daily sweep has not
   * relabelled, and it understands mileage thresholds, which no status can.
   */
  it('serves ?due=overdue including work the sweep has not relabelled', async () => {
    // Scoped to the vehicle carrying the seeded overdue job. Without that,
    // the assertion depends on it landing in the first page — which it does on
    // the demo seed and does not once the reference dataset is loaded.
    const response = await request(h.app)
      .get(`${API}/maintenance?due=overdue&vehicleId=${SEED.vehicle.car1}&pageSize=100`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.data.every((o: { status: string }) => o.status !== 'COMPLETED')).toBe(
      true,
    );
    expect(response.body.data.map((o: { id: string }) => o.id)).toContain(SEED.op.overdue);
  });

  it('serves ?due=upcoming and never overlaps with overdue', async () => {
    const [upcoming, overdue] = await Promise.all([
      request(h.app).get(`${API}/maintenance?due=upcoming&pageSize=100`).set(h.auth('ADMIN')),
      request(h.app).get(`${API}/maintenance?due=overdue&pageSize=100`).set(h.auth('ADMIN')),
    ]);
    const overdueIds = new Set(overdue.body.data.map((o: { id: string }) => o.id));
    // A job cannot be both. If the two buckets ever intersect, the dashboard's
    // two counters double-count the same work.
    for (const op of upcoming.body.data) {
      expect(overdueIds.has(op.id)).toBe(false);
    }
  });

  it('rejects an unknown due bucket', async () => {
    const response = await request(h.app).get(`${API}/maintenance?due=later`).set(h.auth('ADMIN'));
    expect(response.status).toBe(422);
  });

  it('scopes a mechanic to their assigned work — MNT-07', async () => {
    const response = await request(h.app).get(`${API}/maintenance`).set(h.auth('MECHANIC'));
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
    expect(
      response.body.data.every(
        (o: { mechanicId: string | null }) => o.mechanicId === SEED.user.mechanic,
      ),
    ).toBe(true);
  });

  it('scopes a driver to their own vehicle', async () => {
    const response = await request(h.app).get(`${API}/maintenance`).set(h.auth('DRIVER'));
    expect(
      response.body.data.every((o: { vehicleId: string }) => o.vehicleId === SEED.vehicle.van1),
    ).toBe(true);
  });

  it('404s a job outside the caller’s scope', async () => {
    const response = await request(h.app)
      .get(`${API}/maintenance/${SEED.op.overdue}`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Writes and the status workflow — MNT-06
// ---------------------------------------------------------------------------

describe('maintenance lifecycle', () => {
  it('creates unexpected work with no due date', async () => {
    const id = await createOp();
    const response = await request(h.app).get(`${API}/maintenance/${id}`).set(h.auth('ADMIN'));
    expect(response.body.operation.status).toBe('PLANNED');
  });

  it('refuses scheduled work with nothing to make it due', async () => {
    // Mirrors the database CHECK: such a job never appears in an upcoming list
    // and never becomes overdue, so it is invisible for ever.
    const response = await request(h.app)
      .post(`${API}/maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, title: 'Ghost', kind: 'SCHEDULED' });
    expect(response.status).toBe(422);
  });

  it('walks PLANNED → IN_PROGRESS → COMPLETED', async () => {
    const id = await createOp();

    const started = await request(h.app)
      .patch(`${API}/maintenance/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'IN_PROGRESS' });
    expect(started.status).toBe(200);

    const completed = await request(h.app)
      .patch(`${API}/maintenance/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'COMPLETED', costParts: '120.50', costLabour: '79.50' });
    expect(completed.status).toBe(200);
    expect(completed.body.operation.completedAt).toBeTruthy();
  });

  it('keeps COMPLETED terminal', async () => {
    const id = await createOp();
    await request(h.app)
      .patch(`${API}/maintenance/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'COMPLETED' });

    const reopened = await request(h.app)
      .patch(`${API}/maintenance/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'IN_PROGRESS' });
    expect(reopened.status).toBe(409);
  });

  it('refuses to edit completed work', async () => {
    const id = await createOp();
    await request(h.app)
      .patch(`${API}/maintenance/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'COMPLETED' });

    const edit = await request(h.app)
      .patch(`${API}/maintenance/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ title: 'Renamed after the fact' });
    expect(edit.status).toBe(409);
  });

  /**
   * MNT-05, and the invariant RPT-06 depends on.
   *
   * `cost_total` is pinned to `parts + labour` by a database CHECK, so an
   * exported figure and the dashboard cannot disagree because one of them added
   * the components and the other read a stale stored total.
   */
  it('derives the total from parts and labour', async () => {
    const id = await createOp({ costParts: '310.50', costLabour: '180.00' });
    const response = await request(h.app).get(`${API}/maintenance/${id}`).set(h.auth('ACCOUNTANT'));
    expect(response.body.operation.costTotal).toBe('490.50');
  });

  it('re-derives the total when only one component changes', async () => {
    const id = await createOp({ costParts: '100.00', costLabour: '50.00' });
    await request(h.app)
      .patch(`${API}/maintenance/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ costLabour: '75.00' });
    const response = await request(h.app).get(`${API}/maintenance/${id}`).set(h.auth('ADMIN'));
    expect(response.body.operation.costTotal).toBe('175.00');
  });

  it('rejects a negative cost', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, title: 'Refund', costParts: '-10.00' });
    expect(response.status).toBe(422);
  });

  it('assigns a mechanic — MNT-07', async () => {
    const id = await createOp();
    const response = await request(h.app)
      .post(`${API}/maintenance/${id}/assign`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mechanicId: SEED.user.mechanic });
    expect(response.status).toBe(200);
    expect(response.body.operation.mechanicId).toBe(SEED.user.mechanic);
  });

  it('refuses to assign somebody who is not a mechanic', async () => {
    const id = await createOp();
    const response = await request(h.app)
      .post(`${API}/maintenance/${id}/assign`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mechanicId: SEED.user.accountant });
    expect([409, 422]).toContain(response.status);
  });

  it('lets the assigned mechanic update their own job but not another', async () => {
    const mine = await createOp();
    await request(h.app)
      .post(`${API}/maintenance/${mine}/assign`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ mechanicId: SEED.user.mechanic });

    const ownUpdate = await request(h.app)
      .patch(`${API}/maintenance/${mine}/status`)
      .set(h.auth('MECHANIC'))
      .send({ status: 'IN_PROGRESS' });
    expect(ownUpdate.status).toBe(200);

    const unassigned = await createOp();
    const otherUpdate = await request(h.app)
      .patch(`${API}/maintenance/${unassigned}/status`)
      .set(h.auth('MECHANIC'))
      .send({ status: 'IN_PROGRESS' });
    // Scoped out entirely — the mechanic cannot even see it.
    expect(otherUpdate.status).toBe(404);
  });

  it('soft-deletes', async () => {
    const id = await createOp();
    const deleted = await request(h.app).delete(`${API}/maintenance/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);
    const after = await request(h.app).get(`${API}/maintenance/${id}`).set(h.auth('ADMIN'));
    expect(after.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Plans — MNT-04
// ---------------------------------------------------------------------------

describe('maintenance plans', () => {
  it('lists the seeded plans', async () => {
    const response = await request(h.app)
      .get(`${API}/maintenance-plans`)
      .set(h.auth('FLEET_MANAGER'));
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThanOrEqual(3);
  });

  it('creates a plan for a vehicle type', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance-plans`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        name: 'Integration plan',
        vehicleTypeId: SEED.vehicleType.car,
        triggerType: 'DATE',
        intervalDays: 180,
        noticeDays: 14,
      });
    expect(response.status).toBe(201);
    h.track('maintenancePlan', response.body.plan.id);
  });

  it('refuses a DATE plan with no interval', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance-plans`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ name: 'Broken', vehicleTypeId: SEED.vehicleType.car, triggerType: 'DATE' });
    expect(response.status).toBe(422);
  });

  it('refuses a plan that targets neither a vehicle nor a type', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance-plans`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ name: 'Orphan', triggerType: 'DATE', intervalDays: 90 });
    expect(response.status).toBe(422);
  });

  it('404s an unknown plan', async () => {
    const response = await request(h.app)
      .get(`${API}/maintenance-plans/00000000-0000-4000-8000-999999999999`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The trigger engine — MNT-02, and the failure that is silent
// ---------------------------------------------------------------------------

describe('POST /maintenance/run-triggers', () => {
  /**
   * Idempotence, proven rather than asserted.
   *
   * The guarantee is a partial unique index, not a read-then-write check, so
   * this is really a test that the index exists and covers what it claims. A
   * second run creating even one duplicate would mean every UAT tester pressing
   * "run" produces a fresh copy of the entire schedule.
   */
  it('creates nothing on a second run', async () => {
    const first = await request(h.app)
      .post(`${API}/maintenance/run-triggers`)
      .set(h.auth('FLEET_MANAGER'));
    expect(first.status).toBe(200);
    for (const row of first.body.created as Array<{ operationId: string }>) {
      h.track('maintenanceOp', row.operationId);
    }

    const second = await request(h.app)
      .post(`${API}/maintenance/run-triggers`)
      .set(h.auth('FLEET_MANAGER'));
    expect(second.status).toBe(200);
    expect(second.body.operationsCreated).toBe(0);
    expect(second.body.created).toHaveLength(0);
    // The engine still *evaluated* everything — creating nothing because there
    // is nothing to create is a different state from not running at all.
    expect(second.body.plansEvaluated).toBeGreaterThan(0);

    const third = await request(h.app)
      .post(`${API}/maintenance/run-triggers`)
      .set(h.auth('FLEET_MANAGER'));
    expect(third.body.operationsCreated).toBe(0);
  });

  it('is refused to a mechanic', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance/run-triggers`)
      .set(h.auth('MECHANIC'));
    expect(response.status).toBe(403);
  });
});
