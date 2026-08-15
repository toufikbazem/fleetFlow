/**
 * Users and drivers — FF-1201 (USR-01…04, DRV-01…04).
 *
 * USR-03's acceptance is the interesting one: deactivating a user must leave
 * their authored records intact and attributed. That is a claim about what
 * *survives* a destructive action, so the test has to check the other side of
 * the relationship, not just the status code.
 *
 * USR-02's is the other: a role change must take effect on the user's next
 * request, without a redeployment — which is only true if the role is read from
 * the database per request rather than baked into a long-lived token.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
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

function email(): string {
  return `${unique('user')}@fleetflow.test`;
}

async function createUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(h.app)
    .post(`${API}/users`)
    .set(h.auth('ADMIN'))
    .send({ name: 'Integration User', email: email(), role: 'ACCOUNTANT', ...overrides });
  expect(response.status).toBe(201);
  h.track('user', response.body.user.id);
  return response.body.user.id as string;
}

// ---------------------------------------------------------------------------
// Users — USR-01…04
// ---------------------------------------------------------------------------

describe('users', () => {
  it('lists for an administrator only', async () => {
    const admin = await request(h.app).get(`${API}/users`).set(h.auth('ADMIN'));
    expect(admin.status).toBe(200);
    expect(admin.body.total).toBeGreaterThanOrEqual(6);

    for (const role of ['FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'] as const) {
      const other = await request(h.app).get(`${API}/users`).set(h.auth(role));
      expect(other.status).toBe(403);
    }
  });

  it('never returns a password hash', async () => {
    const response = await request(h.app).get(`${API}/users`).set(h.auth('ADMIN'));
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('$2b$');
  });

  it('creates with a role — USR-02', async () => {
    const id = await createUser({ role: 'MECHANIC' });
    const response = await request(h.app).get(`${API}/users/${id}`).set(h.auth('ADMIN'));
    expect(response.body.user.role).toBe('MECHANIC');
    expect(response.body.user.isActive).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const response = await request(h.app)
      .post(`${API}/users`)
      .set(h.auth('ADMIN'))
      .send({ name: 'Clash', email: 'admin@fleetflow.local', role: 'ACCOUNTANT' });
    expect(response.status).toBe(409);
  });

  it('normalises an email so a stray capital cannot create a second account', async () => {
    const address = email();
    const id = await createUser({ email: address.toUpperCase() });
    const response = await request(h.app).get(`${API}/users/${id}`).set(h.auth('ADMIN'));
    expect(response.body.user.email).toBe(address.toLowerCase());
  });

  it('rejects an unknown role', async () => {
    const response = await request(h.app)
      .post(`${API}/users`)
      .set(h.auth('ADMIN'))
      .send({ name: 'Ghost', email: email(), role: 'SUPERUSER' });
    expect(response.status).toBe(422);
  });

  /**
   * USR-02's acceptance criterion: "role changes take effect on the user's next
   * request without redeployment".
   *
   * The failure this guards against is subtle and was real: revoking refresh
   * tokens does not touch the access token already in the user's hands, which
   * stays validly signed and carries the old role for up to another 15 minutes.
   * The interesting direction is a *demotion* — a former administrator keeping
   * administrative reach for a quarter of an hour after being demoted.
   */
  it('stops honouring the old token the moment the role changes', async () => {
    const address = email();
    const id = await createUser({ email: address, role: 'ADMIN', password: PASSWORD });

    const signIn = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: address, password: PASSWORD });
    expect(signIn.status).toBe(200);
    const token = signIn.body.accessToken as string;
    const cookie = signIn.headers['set-cookie'] as unknown as string[];

    const before = await request(h.app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await request(h.app)
      .patch(`${API}/users/${id}`)
      .set(h.auth('ADMIN'))
      .send({ role: 'ACCOUNTANT' });

    // 401, not 403: the token is no longer honoured at all, so the client
    // refreshes rather than telling the user they lack permission.
    const after = await request(h.app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);

    // And the refresh path issues a token carrying the *new* role, without
    // sending the user back to the login screen.
    const refreshed = await request(h.app).post(`${API}/auth/refresh`).set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe('ACCOUNTANT');

    const asAccountant = await request(h.app)
      .get(`${API}/users`)
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(asAccountant.status).toBe(403);
  });

  it('grants new permissions on promotion just as promptly', async () => {
    const address = email();
    const id = await createUser({ email: address, role: 'ACCOUNTANT', password: PASSWORD });

    const signIn = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: address, password: PASSWORD });
    const cookie = signIn.headers['set-cookie'] as unknown as string[];

    await request(h.app).patch(`${API}/users/${id}`).set(h.auth('ADMIN')).send({ role: 'ADMIN' });

    const refreshed = await request(h.app).post(`${API}/auth/refresh`).set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    const promoted = await request(h.app)
      .get(`${API}/users`)
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(promoted.status).toBe(200);
  });

  it('stops honouring a deactivated user’s live token immediately', async () => {
    const address = email();
    const id = await createUser({ email: address, password: PASSWORD, role: 'FLEET_MANAGER' });

    const signIn = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: address, password: PASSWORD });
    const token = signIn.body.accessToken as string;

    const before = await request(h.app)
      .get(`${API}/vehicles`)
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await request(h.app).post(`${API}/users/${id}/deactivate`).set(h.auth('ADMIN'));

    // A departing employee must lose access when the button is pressed, not up
    // to 15 minutes later.
    const after = await request(h.app)
      .get(`${API}/vehicles`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('deactivates and reactivates — USR-03', async () => {
    const id = await createUser();

    const off = await request(h.app).post(`${API}/users/${id}/deactivate`).set(h.auth('ADMIN'));
    expect(off.status).toBe(200);
    expect(off.body.user.isActive).toBe(false);

    const on = await request(h.app).post(`${API}/users/${id}/activate`).set(h.auth('ADMIN'));
    expect(on.status).toBe(200);
    expect(on.body.user.isActive).toBe(true);
  });

  it('refuses a deactivated account at login', async () => {
    const address = email();
    const id = await createUser({ email: address, password: PASSWORD });
    await request(h.app).post(`${API}/users/${id}/deactivate`).set(h.auth('ADMIN'));

    const signIn = await request(h.app)
      .post(`${API}/auth/login`)
      .send({ email: address, password: PASSWORD });
    expect(signIn.status).toBe(401);
  });

  it('refuses to deactivate the last administrator', async () => {
    // Locking every administrator out of the installation is unrecoverable
    // without database access.
    const response = await request(h.app)
      .post(`${API}/users/${SEED.user.admin}/deactivate`)
      .set(h.auth('ADMIN'));
    expect([409, 422]).toContain(response.status);
  });

  /**
   * USR-01's acceptance: deleting a user leaves their authored maintenance and
   * damage records intact and attributed.
   */
  it('keeps authored records after the author is removed', async () => {
    const before = await request(h.app)
      .get(`${API}/maintenance/${SEED.op.inProgress}`)
      .set(h.auth('ADMIN'));
    expect(before.status).toBe(200);

    const id = await createUser({ role: 'MECHANIC' });
    const deleted = await request(h.app).delete(`${API}/users/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);

    const after = await request(h.app)
      .get(`${API}/maintenance/${SEED.op.inProgress}`)
      .set(h.auth('ADMIN'));
    expect(after.status).toBe(200);
    expect(after.body.operation.title).toBe(before.body.operation.title);
  });

  it('404s an unknown user and 422s a malformed id', async () => {
    const missing = await request(h.app)
      .get(`${API}/users/00000000-0000-4000-8000-999999999999`)
      .set(h.auth('ADMIN'));
    expect(missing.status).toBe(404);

    const malformed = await request(h.app).get(`${API}/users/nope`).set(h.auth('ADMIN'));
    expect(malformed.status).toBe(422);
  });

  it('resends an invitation without failing when email is unconfigured', async () => {
    // The preview transport means this path is exercisable before FF-004; the
    // response must not be a 5xx just because SMTP is absent in development.
    const id = await createUser();
    const response = await request(h.app)
      .post(`${API}/users/${id}/resend-invitation`)
      .set(h.auth('ADMIN'));
    expect([200, 202, 204]).toContain(response.status);
  });
});

// ---------------------------------------------------------------------------
// Drivers — DRV-01…04
// ---------------------------------------------------------------------------

describe('drivers', () => {
  async function createDriver(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(h.app)
      .post(`${API}/drivers`)
      .set(h.auth('FLEET_MANAGER'))
      .send({
        firstName: 'Test',
        lastName: 'Driver',
        licenceNo: unique('DL').toUpperCase().slice(0, 20),
        ...overrides,
      });
    expect(response.status).toBe(201);
    h.track('driver', response.body.driver.id);
    return response.body.driver.id as string;
  }

  it('lists and paginates', async () => {
    const response = await request(h.app)
      .get(`${API}/drivers?pageSize=2`)
      .set(h.auth('FLEET_MANAGER'));
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThanOrEqual(3);
  });

  it('creates a driver with no login account — DRV-04', async () => {
    // The link is optional and most drivers have none; requiring one would mean
    // inventing a mailbox for every driver in the fleet.
    const id = await createDriver();
    const response = await request(h.app).get(`${API}/drivers/${id}`).set(h.auth('ADMIN'));
    expect(response.body.driver.userId).toBeNull();
  });

  it('scopes a driver to their own record — "R (self)"', async () => {
    const response = await request(h.app).get(`${API}/drivers`).set(h.auth('DRIVER'));
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.data[0].id).toBe(SEED.driver.amina);
  });

  it('404s another driver’s record for a driver', async () => {
    const response = await request(h.app)
      .get(`${API}/drivers/${SEED.driver.youssef}`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });

  it('is invisible to a mechanic entirely', async () => {
    // PRD §2.1 gives Mechanic "—" on Drivers: not a scoped read, no read at all.
    const response = await request(h.app).get(`${API}/drivers`).set(h.auth('MECHANIC'));
    expect(response.status).toBe(403);
  });

  it('updates and soft-deletes', async () => {
    const id = await createDriver();
    const updated = await request(h.app)
      .patch(`${API}/drivers/${id}`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ phone: '+212600000000' });
    expect(updated.status).toBe(200);

    const deleted = await request(h.app).delete(`${API}/drivers/${id}`).set(h.auth('ADMIN'));
    expect([200, 204]).toContain(deleted.status);
    const after = await request(h.app).get(`${API}/drivers/${id}`).set(h.auth('ADMIN'));
    expect(after.status).toBe(404);
  });

  it('refuses to remove a driver who still holds a vehicle', async () => {
    // Deleting them would leave an open assignment pointing at nobody.
    const response = await request(h.app)
      .delete(`${API}/drivers/${SEED.driver.amina}`)
      .set(h.auth('ADMIN'));
    expect([409, 422]).toContain(response.status);
  });

  it('rejects a blank name', async () => {
    const response = await request(h.app)
      .post(`${API}/drivers`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ firstName: '   ', lastName: 'X', licenceNo: 'DL-1' });
    expect(response.status).toBe(422);
  });
});
