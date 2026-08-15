/**
 * Security sweep — FF-1203 (§13 launch checklist).
 *
 * A review that produces a document nobody re-runs is a review that is true on
 * the day it is written. These are the checks that can be executed, so they run
 * on every commit and a regression fails the build rather than waiting for the
 * next audit.
 *
 * Scope, matching the task: authorisation and IDOR, upload handling, transport
 * headers, CORS, secret hygiene in responses and logs, and injection. The
 * dependency audit is a separate command and is recorded in the E12 notes,
 * because it changes with the registry rather than with this repository.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../modules/auth/routes.js';
import {
  ACCOUNTS,
  PASSWORD,
  SEED,
  setupHarness,
  teardownHarness,
  type Harness,
} from '../testing/harness.js';

const API = '/api/v1';
let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await teardownHarness(h);
});

// ---------------------------------------------------------------------------
// IDOR — the failure mode a status-code test never catches
// ---------------------------------------------------------------------------

describe('insecure direct object references', () => {
  /**
   * A Driver is *allowed* to read vehicles, maintenance, documents and damages.
   * The question is which rows — and a guard that answers 200 to "read
   * vehicles" while handing over the whole fleet is a breach that every
   * authorisation test in the previous suite would pass.
   */
  it('never returns another vehicle’s records to a driver', async () => {
    const foreign = [
      `/vehicles/${SEED.vehicle.truck1}`,
      `/vehicles/${SEED.vehicle.car1}`,
      `/vehicles/${SEED.vehicle.truck1}/overview`,
      `/vehicles/${SEED.vehicle.truck1}/mileage`,
      `/maintenance/${SEED.op.overdue}`,
      `/documents/${SEED.document.truck1Insurance}`,
    ];

    for (const path of foreign) {
      const response = await request(h.app).get(`${API}${path}`).set(h.auth('DRIVER'));
      // 404 rather than 403: confirming the id exists would let the fleet's
      // shape be mapped one probe at a time.
      expect([403, 404], `${path} → ${response.status}`).toContain(response.status);
    }
  });

  it('never lists another driver’s record to a driver', async () => {
    const response = await request(h.app)
      .get(`${API}/drivers/${SEED.driver.youssef}`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });

  it('does not let a driver write to a vehicle they do not hold', async () => {
    const response = await request(h.app).post(`${API}/damages`).set(h.auth('DRIVER')).send({
      vehicleId: SEED.vehicle.truck1,
      description: 'Attempting to report on a vehicle I do not hold',
      severity: 'LOW',
    });
    expect([403, 404, 422]).toContain(response.status);
  });

  it('does not let a mechanic reach maintenance outside their queue', async () => {
    // `op.overdue` is unassigned in the seed; `op.planned` is this mechanic's
    // own job and is deliberately used as the control below, so the assertion
    // proves scoping rather than a blanket refusal.
    const foreign = await request(h.app)
      .patch(`${API}/maintenance/${SEED.op.overdue}/status`)
      .set(h.auth('MECHANIC'))
      .send({ status: 'IN_PROGRESS' });
    expect([403, 404]).toContain(foreign.status);

    const own = await request(h.app)
      .get(`${API}/maintenance/${SEED.op.planned}`)
      .set(h.auth('MECHANIC'));
    expect(own.status).toBe(200);
  });

  it('does not let one user mark another’s notification read', async () => {
    await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    const managers = await request(h.app).get(`${API}/notifications`).set(h.auth('FLEET_MANAGER'));
    const id = managers.body.data[0]?.id as string | undefined;
    if (id) {
      const response = await request(h.app)
        .post(`${API}/notifications/${id}/read`)
        .set(h.auth('MECHANIC'));
      expect(response.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// Secret hygiene
// ---------------------------------------------------------------------------

describe('secrets never leave the process', () => {
  it('does not return a password hash from any user endpoint', async () => {
    for (const path of [`/users`, `/users/${SEED.user.manager}`, `/auth/me`]) {
      const response = await request(h.app).get(`${API}${path}`).set(h.auth('ADMIN'));
      const body = JSON.stringify(response.body);
      expect(body, path).not.toContain('passwordHash');
      // bcrypt hashes are recognisable by their prefix, so this catches the
      // field being renamed rather than removed.
      expect(body, path).not.toMatch(/\$2[aby]\$/);
    }
  });

  it('does not echo the submitted password back in a validation error', async () => {
    const response = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: 'not-an-email', password: 'hunter2-secret-value' });
    expect(JSON.stringify(response.body)).not.toContain('hunter2-secret-value');
  });

  it('does not leak the refresh token to script', async () => {
    const response = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: ACCOUNTS.ADMIN, password: PASSWORD });

    // It must be a cookie, and the cookie must be unreadable by JavaScript —
    // otherwise an XSS payload steals a credential good for days rather than
    // for the access token's fifteen minutes.
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite/i);

    // And it must not also appear in the JSON, which would put it in memory
    // reachable by script and undo the cookie's protection.
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');
  });

  it('does not reveal whether an account exists', async () => {
    // AUTH-01's acceptance: "a generic error that does not reveal whether the
    // account exists".
    const missing = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@fleetflow.local', password: PASSWORD });
    const wrongPassword = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: ACCOUNTS.ADMIN, password: 'not-the-password' });

    expect(missing.status).toBe(wrongPassword.status);
    expect(missing.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('does not reveal whether an address is registered when resetting', async () => {
    const known = await request(h.app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: ACCOUNTS.ADMIN });
    const unknown = await request(h.app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'nobody@fleetflow.local' });
    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
  });

  it('does not expose a stack trace or SQL in a 500', async () => {
    // A malformed body reaches the error handler; whatever it answers must not
    // describe the internals.
    const response = await request(h.app)
      .post(`${API}/vehicles`)
      .set(h.auth('ADMIN'))
      .set('Content-Type', 'application/json')
      .send('{"plate": ');
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/at .+\.ts:\d+/);
    expect(body).not.toContain('SELECT');
    expect(body).not.toContain('prisma');
  });
});

// ---------------------------------------------------------------------------
// Transport headers
// ---------------------------------------------------------------------------

describe('response headers', () => {
  it('sets the headers that matter for an API', async () => {
    const response = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // The API serves JSON and must never be framed or rendered.
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('does not advertise the server technology', async () => {
    const response = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));
    // `X-Powered-By: Express` tells an attacker which CVEs to try first.
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('carries a request id, so a client failure can be traced to a log line', async () => {
    const response = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('marks an export as an attachment and forbids sniffing', async () => {
    const response = await request(h.app)
      .get(`${API}/reports/cost-by-vehicle/export?format=csv`)
      .set(h.auth('ADMIN'));
    // Without both, a CSV whose first cell contains markup can be sniffed as
    // HTML and rendered same-origin.
    expect(response.headers['content-disposition']).toMatch(/^attachment/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe('CORS', () => {
  it('does not reflect an arbitrary origin', async () => {
    // Reflecting the Origin with credentials:true would let any site on the
    // internet make authenticated requests with the user's refresh cookie.
    const response = await request(h.app)
      .get(`${API}/vehicles`)
      .set('Origin', 'https://evil.test')
      .set(h.auth('ADMIN'));
    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.test');
  });

  it('never answers with a wildcard while allowing credentials', async () => {
    const response = await request(h.app)
      .get(`${API}/vehicles`)
      .set('Origin', 'https://evil.test')
      .set(h.auth('ADMIN'));
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});

// ---------------------------------------------------------------------------
// Injection and input handling
// ---------------------------------------------------------------------------

describe('input handling', () => {
  it('treats a SQL payload in a search term as text', async () => {
    // The list endpoints that use raw SQL bind their parameters; this proves the
    // binding rather than assuming it.
    const response = await request(h.app)
      .get(`${API}/vehicles?q=${encodeURIComponent("'; DROP TABLE vehicles; --")}`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);

    const stillThere = await request(h.app).get(`${API}/vehicles`).set(h.auth('ADMIN'));
    expect(stillThere.body.total).toBeGreaterThan(0);
  });

  it('treats a SQL payload in a document search as text', async () => {
    const response = await request(h.app)
      .get(`${API}/documents?q=${encodeURIComponent("' OR 1=1 --")}`)
      .set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    // `' OR 1=1 --` interpreted as SQL would return everything; as text it
    // matches nothing.
    expect(response.body.total).toBe(0);
  });

  it('stores markup as text rather than interpreting it', async () => {
    const payload = '<script>alert(1)</script>';
    const created = await request(h.app)
      .post(`${API}/maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, title: payload });
    h.track('maintenanceOp', created.body.operation.id);

    // Stored verbatim and returned as a JSON string. Escaping belongs at the
    // point of rendering; escaping on the way in corrupts the data instead.
    expect(created.body.operation.title).toBe(payload);
    expect(created.headers['content-type']).toContain('application/json');
  });

  it('rejects an oversized body', async () => {
    const response = await request(h.app)
      .post(`${API}/maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, title: 'x', description: 'y'.repeat(5_000_000) });
    expect([413, 422]).toContain(response.status);
  });

  it('rejects a malformed JSON body as 422, not 500', async () => {
    const response = await request(h.app)
      .post(`${API}/vehicles`)
      .set(h.auth('ADMIN'))
      .set('Content-Type', 'application/json')
      .send('{"plate": ');
    expect(response.status).toBe(422);
  });

  it('rejects a path parameter that is not a uuid', async () => {
    // Otherwise the value reaches a query and the failure is a database error.
    const response = await request(h.app)
      .get(`${API}/vehicles/../../etc/passwd`)
      .set(h.auth('ADMIN'));
    expect(response.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Upload handling — DOC-02, MNT-03, DMG-04
// ---------------------------------------------------------------------------

describe('upload handling', () => {
  const base = {
    entityType: 'DOCUMENT' as const,
    entityId: SEED.document.van1Insurance,
    kind: 'SCAN' as const,
    sizeBytes: 1024,
  };

  it('refuses an executable', async () => {
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ ...base, fileName: 'payload.exe', mimeType: 'application/x-msdownload' });
    expect(response.status).toBe(422);
  });

  it('refuses HTML, which would be same-origin script if ever served inline', async () => {
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ ...base, fileName: 'page.html', mimeType: 'text/html' });
    expect(response.status).toBe(422);
  });

  it('refuses SVG, which carries script inside an image content type', async () => {
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ ...base, fileName: 'logo.svg', mimeType: 'image/svg+xml' });
    expect(response.status).toBe(422);
  });

  it('refuses a file above the configured limit', async () => {
    const response = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        ...base,
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500 * 1024 * 1024,
      });
    expect(response.status).toBe(422);
  });

  it('validates before consulting storage', async () => {
    // The order matters: a rejected file must be rejected on its own merits,
    // not incidentally because Supabase is unconfigured. Otherwise the
    // validation is untested until the day credentials arrive.
    const bad = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ ...base, fileName: 'x.exe', mimeType: 'application/x-msdownload' });
    const good = await request(h.app)
      .post(`${API}/attachments/upload-url`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ ...base, fileName: 'x.pdf', mimeType: 'application/pdf' });

    expect(bad.status).toBe(422);
    expect(good.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — AUTH-05
// ---------------------------------------------------------------------------

describe('brute force resistance', () => {
  it('locks an account after repeated failures without locking the whole office', async () => {
    const target = ACCOUNTS.ACCOUNTANT;

    let lockedOut = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await request(h.app)
        .post(`${API}/auth/login`)
        .send({ email: target, password: `wrong-${attempt}` });
      if (response.status === 429) {
        lockedOut = true;
        break;
      }
    }
    expect(lockedOut).toBe(true);

    // The per-account lockout is the precise instrument. A per-IP limit tight
    // enough to stop this would lock out every colleague behind the same office
    // NAT, so a different account from the same address must still work.
    const other = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: ACCOUNTS.ADMIN, password: PASSWORD });
    expect(other.status).toBe(200);
  });
});
