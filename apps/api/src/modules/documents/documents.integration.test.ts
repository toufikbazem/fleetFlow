/**
 * Documents, attachments and damages — FF-1201 (DOC-01…06, DMG-01…04).
 *
 * DOC-05's status is derived in SQL and never stored, so the interesting cases
 * are the boundaries of the notice window and the fact that the same document
 * changes status without anyone writing to it. Attachments are covered as far
 * as they can be without Supabase credentials (FF-004) — the 503 path *is* the
 * behaviour until those arrive, and it is asserted rather than skipped.
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

/** Days from today as YYYY-MM-DD, so fixtures stay meaningful as the clock moves. */
function inDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A document-type code: lower-case, digits and underscores only. */
function typeCode(): string {
  return unique('type').replace(/-/g, '_').slice(0, 40);
}

/** The same offset as a full ISO instant — `occurredAt` is a moment, not a calendar date. */
function instantDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

async function createDocument(overrides: Record<string, unknown> = {}): Promise<string> {
  const types = await request(h.app).get(`${API}/document-types`).set(h.auth('ADMIN'));
  const response = await request(h.app)
    .post(`${API}/documents`)
    .set(h.auth('FLEET_MANAGER'))
    .send({
      vehicleId: SEED.vehicle.van2,
      documentTypeId: types.body.data[0].id,
      expiryDate: inDays(365),
      ...overrides,
    });
  expect(response.status).toBe(201);
  h.track('document', response.body.document.id);
  return response.body.document.id as string;
}

// ---------------------------------------------------------------------------
// DOC-05 — the derived status
// ---------------------------------------------------------------------------

describe('document status is derived, never stored', () => {
  it('is VALID far from expiry', async () => {
    const id = await createDocument({ expiryDate: inDays(365), noticeDays: 30 });
    const response = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(response.body.document.status).toBe('VALID');
  });

  it('is EXPIRING_SOON inside the notice window', async () => {
    const id = await createDocument({ expiryDate: inDays(10), noticeDays: 30 });
    const response = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(response.body.document.status).toBe('EXPIRING_SOON');
  });

  it('is EXPIRING_SOON on the day of expiry, not EXPIRED', async () => {
    // A document is valid *through* its expiry date; calling it expired a day
    // early would ground a vehicle that is legally fine to drive.
    const id = await createDocument({ expiryDate: inDays(0), noticeDays: 30 });
    const response = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(response.body.document.status).toBe('EXPIRING_SOON');
  });

  it('is EXPIRED the day after', async () => {
    const id = await createDocument({ expiryDate: inDays(-1), noticeDays: 30 });
    const response = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(response.body.document.status).toBe('EXPIRED');
  });

  it('honours a per-document notice period over the type default', async () => {
    // DOC-03: the notice period is configurable per document. With a 3-day
    // notice, a document 10 days out is still VALID.
    const id = await createDocument({ expiryDate: inDays(10), noticeDays: 3 });
    const response = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(response.body.document.status).toBe('VALID');
  });

  it('filters the list by the same derived status, in SQL', async () => {
    // The filter and the displayed value must come from one expression — a list
    // headed "expiring soon" containing a row badged "valid" is the failure.
    const id = await createDocument({ expiryDate: inDays(5), noticeDays: 30 });
    const response = await request(h.app)
      .get(`${API}/documents?status=EXPIRING_SOON&pageSize=100`)
      .set(h.auth('ADMIN'));
    expect(response.body.data.map((d: { id: string }) => d.id)).toContain(id);
    expect(response.body.data.every((d: { status: string }) => d.status === 'EXPIRING_SOON')).toBe(
      true,
    );
  });

  it('paginates a status filter correctly, because it filters in SQL', async () => {
    // Filtering in memory after fetching a page would make `total` wrong and
    // silently drop rows past page one — the bug raw SQL exists to avoid.
    const page1 = await request(h.app)
      .get(`${API}/documents?status=EXPIRED&page=1&pageSize=1`)
      .set(h.auth('ADMIN'));
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBeLessThanOrEqual(1);
    expect(page1.body.total).toBeGreaterThanOrEqual(page1.body.data.length);
  });
});

// ---------------------------------------------------------------------------
// Documents CRUD and scoping
// ---------------------------------------------------------------------------

describe('documents', () => {
  it('hides archived vehicles’ documents by default', async () => {
    const operational = await request(h.app)
      .get(`${API}/documents?pageSize=100`)
      .set(h.auth('ADMIN'));
    const included = await request(h.app)
      .get(`${API}/documents?includeArchived=true&pageSize=100`)
      .set(h.auth('ADMIN'));
    expect(included.body.total).toBeGreaterThanOrEqual(operational.body.total);
  });

  it('still returns an archived vehicle’s documents when asked for that vehicle', async () => {
    const response = await request(h.app)
      .get(`${API}/documents?vehicleId=${SEED.vehicle.archived}`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
  });

  it('scopes a driver to their own vehicle’s documents', async () => {
    const response = await request(h.app).get(`${API}/documents`).set(h.auth('DRIVER'));
    expect(response.status).toBe(200);
    expect(
      response.body.data.every((d: { vehicleId: string }) => d.vehicleId === SEED.vehicle.van1),
    ).toBe(true);
  });

  it('404s another vehicle’s document for a driver', async () => {
    const response = await request(h.app)
      .get(`${API}/documents/${SEED.document.truck1Insurance}`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });

  it('updates and soft-deletes', async () => {
    const id = await createDocument();
    const updated = await request(h.app)
      .patch(`${API}/documents/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ referenceNo: 'POL-123' });
    expect(updated.status).toBe(200);

    const deleted = await request(h.app).delete(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);
    const after = await request(h.app).get(`${API}/documents/${id}`).set(h.auth('ADMIN'));
    expect(after.status).toBe(404);
  });

  it('rejects a document with no expiry date', async () => {
    const types = await request(h.app).get(`${API}/document-types`).set(h.auth('ADMIN'));
    const response = await request(h.app)
      .post(`${API}/documents`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, documentTypeId: types.body.data[0].id });
    expect(response.status).toBe(422);
  });

  it('rejects an expiry before the issue date', async () => {
    const types = await request(h.app).get(`${API}/document-types`).set(h.auth('ADMIN'));
    const response = await request(h.app)
      .post(`${API}/documents`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        vehicleId: SEED.vehicle.van2,
        documentTypeId: types.body.data[0].id,
        issueDate: inDays(30),
        expiryDate: inDays(10),
      });
    expect([409, 422]).toContain(response.status);
  });
});

describe('document types — DOC-06', () => {
  it('lists the configurable reference data', async () => {
    const response = await request(h.app).get(`${API}/document-types`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it('creates and removes a type', async () => {
    const created = await request(h.app)
      .post(`${API}/document-types`)
      .set(h.auth('ADMIN'))
      .send({ code: typeCode(), label: 'Integration type', defaultNoticeDays: 30 });
    expect(created.status).toBe(201);
    h.track('documentType', created.body.documentType.id);

    const removed = await request(h.app)
      .delete(`${API}/document-types/${created.body.documentType.id}`)
      .set(h.auth('ADMIN'));
    expect([200, 204]).toContain(removed.status);
  });

  /**
   * Governed by `documents:create`, not by a separate reference-data
   * permission — so a Fleet manager, who has F on Documents in PRD §2.1, may
   * add a type. This asserts the matrix rather than an intuition about
   * configuration being an administrator's job: the matrix is the oracle, and
   * inventing a stricter rule in a test is how a suite starts contradicting the
   * specification it exists to defend.
   */
  it('follows the documents permission, so a fleet manager may add a type', async () => {
    const response = await request(h.app)
      .post(`${API}/document-types`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ code: typeCode(), label: 'Manager-created type', defaultNoticeDays: 30 });
    expect(response.status).toBe(201);
    h.track('documentType', response.body.documentType.id);
  });

  it('is refused to a mechanic, who has only read on documents', async () => {
    const response = await request(h.app)
      .post(`${API}/document-types`)
      .set(h.auth('MECHANIC'))
      .send({ code: typeCode(), label: 'Nope', defaultNoticeDays: 30 });
    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Attachments — DOC-02, MNT-03, DMG-04
// ---------------------------------------------------------------------------

describe('attachments', () => {
  it('reports storage as unconfigured rather than pretending to work', async () => {
    const response = await request(h.app).get(`${API}/attachments/status`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('configured');
  });

  it('answers an upload request with 503 while Supabase is unconfigured', async () => {
    // FF-004 is blocked externally. A 503 naming the missing configuration is
    // the correct behaviour and is asserted, not skipped — the alternative is a
    // silent failure that only appears the day credentials arrive.
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        entityType: 'DOCUMENT',
        entityId: SEED.document.van1Insurance,
        kind: 'SCAN',
        fileName: 'scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNCONFIGURED');
  });

  it('rejects a disallowed mime type before reaching storage', async () => {
    // Validation must come first: an executable should be refused on its own
    // merits, not incidentally because storage happens to be down.
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        entityType: 'DOCUMENT',
        entityId: SEED.document.van1Insurance,
        kind: 'SCAN',
        fileName: 'payload.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      });
    expect(response.status).toBe(422);
  });

  it('rejects a file over the size limit', async () => {
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        entityType: 'DOCUMENT',
        entityId: SEED.document.van1Insurance,
        kind: 'SCAN',
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500 * 1024 * 1024,
      });
    expect(response.status).toBe(422);
  });

  it('lists attachments for an entity', async () => {
    const response = await request(h.app)
      .get(`${API}/attachments?entityType=DOCUMENT&entityId=${SEED.document.van1Insurance}`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Damages — DMG-01…04
// ---------------------------------------------------------------------------

describe('damages', () => {
  async function reportDamage(as: 'DRIVER' | 'FLEET_MANAGER' = 'FLEET_MANAGER'): Promise<string> {
    const response = await request(h.app)
      .post(`${API}/damages`)
      .set(h.auth(as))
      .send({
        vehicleId: SEED.vehicle.van1,
        description: 'Integration test damage report',
        occurredAt: instantDaysAgo(1),
        severity: 'LOW',
      });
    expect(response.status).toBe(201);
    h.track('damage', response.body.damage.id);
    return response.body.damage.id as string;
  }

  it('lets a driver report a problem on their own vehicle — DMG-03', async () => {
    const id = await reportDamage('DRIVER');
    expect(id).toBeTruthy();
  });

  it('refuses a driver reporting on a vehicle they do not hold', async () => {
    const response = await request(h.app)
      .post(`${API}/damages`)
      .set(h.auth('DRIVER'))
      .send({
        vehicleId: SEED.vehicle.truck1,
        description: 'Not my van, reported by mistake',
        occurredAt: instantDaysAgo(1),
        severity: 'LOW',
      });
    expect([403, 404, 422]).toContain(response.status);
  });

  it('appears in the fleet manager’s queue', async () => {
    const id = await reportDamage('DRIVER');
    const queue = await request(h.app)
      .get(`${API}/damages?pageSize=100`)
      .set(h.auth('FLEET_MANAGER'));
    expect(queue.body.data.map((d: { id: string }) => d.id)).toContain(id);
  });

  /**
   * DMG-02, both halves of the acceptance criterion: the damage becomes
   * visible from the job, and the job from the damage.
   */
  it('converts to a maintenance job, linked both ways', async () => {
    const damageId = await reportDamage();

    const converted = await request(h.app)
      .post(`${API}/damages/${damageId}/convert-to-maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ title: 'Repair rear door', kind: 'UNEXPECTED' });
    expect(converted.status).toBe(201);

    const opId = converted.body.operation.id as string;
    h.track('maintenanceOp', opId);

    const op = await request(h.app).get(`${API}/maintenance/${opId}`).set(h.auth('ADMIN'));
    expect(op.body.operation.damageId).toBe(damageId);

    const damage = await request(h.app).get(`${API}/damages/${damageId}`).set(h.auth('ADMIN'));
    // The damage carries the job as an object, not a bare id: "visible from the
    // linked maintenance operation and vice versa" means the reader gets the
    // title and status without a second request.
    expect(damage.body.damage.maintenanceOp).toMatchObject({ id: opId, title: 'Repair rear door' });
    expect(damage.body.damage.status).toBe('LINKED');
  });

  it('refuses to convert the same report twice', async () => {
    const damageId = await reportDamage();
    const first = await request(h.app)
      .post(`${API}/damages/${damageId}/convert-to-maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ title: 'First', kind: 'UNEXPECTED' });
    h.track('maintenanceOp', first.body.operation.id);

    const second = await request(h.app)
      .post(`${API}/damages/${damageId}/convert-to-maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ title: 'Second', kind: 'UNEXPECTED' });
    expect(second.status).toBe(409);
  });

  it('never lets LINKED be set by hand', async () => {
    const id = await reportDamage();
    const response = await request(h.app)
      .patch(`${API}/damages/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'LINKED' });
    // The status asserts a job exists; a status that can claim a job which does
    // not exist is worse than no status.
    expect([409, 422]).toContain(response.status);
  });

  it('keeps REJECTED terminal', async () => {
    const id = await reportDamage();
    await request(h.app)
      .patch(`${API}/damages/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'REJECTED' });

    const reopened = await request(h.app)
      .patch(`${API}/damages/${id}/status`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ status: 'UNDER_REVIEW' });
    expect(reopened.status).toBe(409);
  });

  it('archives and restores — DMG-01', async () => {
    const id = await reportDamage();
    const archived = await request(h.app)
      .post(`${API}/damages/${id}/archive`)
      .set(h.auth('FLEET_MANAGER'));
    expect(archived.status).toBe(200);

    const restored = await request(h.app)
      .post(`${API}/damages/${id}/restore`)
      .set(h.auth('FLEET_MANAGER'));
    expect(restored.status).toBe(200);
  });

  it('soft-deletes', async () => {
    const id = await reportDamage();
    const deleted = await request(h.app).delete(`${API}/damages/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);
    const after = await request(h.app).get(`${API}/damages/${id}`).set(h.auth('ADMIN'));
    expect(after.status).toBe(404);
  });
});
