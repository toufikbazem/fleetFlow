/**
 * The permission matrix across every shipped endpoint — FF-1207 (AUTH-06).
 *
 * FF-207 proved the `authorize()` middleware enforces `MATRIX`, using probe
 * routes. That leaves the question this file answers: **is the middleware
 * actually on the real endpoints, with the right module and action?** A guard
 * that works perfectly and is missing from one route is worth nothing on that
 * route, and nothing in the earlier suite would notice.
 *
 * Three layers, and it is worth being precise about what each proves:
 *
 *   1. **Completeness.** The route list is read out of the live Express router,
 *      so a new endpoint that nobody classified fails the suite. This is the
 *      only guarantee that scales past today.
 *   2. **Denial.** Every role the matrix refuses gets exactly 403 — not 404,
 *      not 500, and above all not 200.
 *   3. **Admission.** Every role the matrix allows gets anything *except* 403.
 *      Not 200: a valid request needs a valid body, and inventing eighty
 *      fixtures would test the fixtures. 422 from validation and 404 from a
 *      missing id both prove the request reached the handler, which is the
 *      claim being made.
 *
 * Row-level scoping is asserted per module in the FF-1201 suites, where the
 * expected rows are known.
 */

import { can, USER_ROLES, type Action, type Module } from '@fleetflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registeredRoutes, routeKey, type RegisteredRoute } from '../../testing/route-inventory.js';
import {
  ACCOUNTS,
  PASSWORD,
  setupHarness,
  teardownHarness,
  type Harness,
} from '../../testing/harness.js';

let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await teardownHarness(h);
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** A route governed by the matrix, and the cell that governs it. */
type Guarded = { kind: 'guarded'; module: Module; action: Action };
/** Reachable by any signed-in user; no module governs it. */
type AnyUser = { kind: 'any-user'; why: string };
/** Deliberately reachable without a token. */
type Public = { kind: 'public'; why: string };

type Classification = Guarded | AnyUser | Public;

const guarded = (module: Module, action: Action): Guarded => ({ kind: 'guarded', module, action });
const anyUser = (why: string): AnyUser => ({ kind: 'any-user', why });
const open = (why: string): Public => ({ kind: 'public', why });

/**
 * The intended guard for every route, transcribed by hand.
 *
 * Hand-written on purpose. Deriving it from the source would mean the test and
 * the code share a single opinion, and the test could only ever confirm that
 * the code agrees with itself.
 */
const EXPECTED: Record<string, Classification> = {
  'GET /healthz': open('Liveness, for the platform. Reveals no data.'),

  // Authentication — the routes that establish identity cannot require it.
  'POST /auth/login': open('AUTH-01.'),
  'POST /auth/refresh': open('Authenticated by the refresh cookie, not a bearer token.'),
  'POST /auth/logout': open('Must work with an already-expired access token (AUTH-04).'),
  'POST /auth/forgot-password': open('AUTH-02. The caller is by definition locked out.'),
  'POST /auth/reset-password': open('AUTH-02. Authenticated by the single-use token.'),
  'GET /auth/me': anyUser('Your own identity.'),

  'GET /users': guarded('users', 'read'),
  'GET /users/:id': guarded('users', 'read'),
  'POST /users': guarded('users', 'create'),
  'PATCH /users/:id': guarded('users', 'update'),
  'POST /users/:id/deactivate': guarded('users', 'update'),
  'POST /users/:id/activate': guarded('users', 'update'),
  'POST /users/:id/resend-invitation': guarded('users', 'update'),
  'DELETE /users/:id': guarded('users', 'delete'),

  'GET /drivers': guarded('drivers', 'read'),
  'GET /drivers/:id': guarded('drivers', 'read'),
  'POST /drivers': guarded('drivers', 'create'),
  'PATCH /drivers/:id': guarded('drivers', 'update'),
  'DELETE /drivers/:id': guarded('drivers', 'delete'),

  'GET /vehicle-types': guarded('vehicles', 'read'),
  'GET /vehicles': guarded('vehicles', 'read'),
  'GET /vehicles/:id': guarded('vehicles', 'read'),
  'GET /vehicles/:id/overview': guarded('vehicles', 'read'),
  'GET /vehicles/:id/mileage': guarded('vehicles', 'read'),
  'POST /vehicles/:id/mileage': guarded('vehicles', 'update'),
  'POST /vehicles': guarded('vehicles', 'create'),
  'PATCH /vehicles/:id': guarded('vehicles', 'update'),
  'POST /vehicles/:id/status': guarded('vehicles', 'update'),
  'DELETE /vehicles/:id': guarded('vehicles', 'delete'),

  'GET /assignments': guarded('drivers', 'read'),
  'POST /assignments': guarded('drivers', 'update'),
  'PATCH /assignments/:id/close': guarded('drivers', 'update'),

  'GET /maintenance-plans': guarded('maintenance', 'read'),
  'GET /maintenance-plans/:id': guarded('maintenance', 'read'),
  'POST /maintenance-plans': guarded('maintenance', 'create'),
  'PATCH /maintenance-plans/:id': guarded('maintenance', 'update'),
  'DELETE /maintenance-plans/:id': guarded('maintenance', 'delete'),
  'GET /maintenance': guarded('maintenance', 'read'),
  'GET /maintenance/:id': guarded('maintenance', 'read'),
  'POST /maintenance': guarded('maintenance', 'create'),
  'PATCH /maintenance/:id': guarded('maintenance', 'update'),
  'PATCH /maintenance/:id/status': guarded('maintenance', 'update'),
  'POST /maintenance/:id/assign': guarded('maintenance', 'update'),
  'DELETE /maintenance/:id': guarded('maintenance', 'delete'),
  'POST /maintenance/run-triggers': guarded('maintenance', 'create'),

  'GET /document-types': guarded('documents', 'read'),
  'POST /document-types': guarded('documents', 'create'),
  'DELETE /document-types/:id': guarded('documents', 'delete'),
  'GET /documents': guarded('documents', 'read'),
  'GET /documents/:id': guarded('documents', 'read'),
  'POST /documents': guarded('documents', 'create'),
  'PATCH /documents/:id': guarded('documents', 'update'),
  'DELETE /documents/:id': guarded('documents', 'delete'),

  // Attachments are polymorphic: the governing module depends on what the file
  // is attached to, so no single `authorize()` can decide before the handler
  // runs. Those services consult the matrix themselves (`assertCanAttach`), and
  // the module-level rules are asserted in the documents suite.
  'GET /attachments/status': anyUser('Whether storage is configured. No data.'),
  'GET /attachments': anyUser('Scoped per entity inside the service.'),
  'POST /attachments/upload-url': anyUser('Scoped per entity inside the service.'),
  'POST /attachments/:id/confirm': anyUser('Scoped per entity inside the service.'),
  'GET /attachments/:id/download-url': anyUser('Scoped per entity inside the service.'),
  'DELETE /attachments/:id': anyUser('Scoped per entity inside the service.'),

  'GET /damages': guarded('damages', 'read'),
  'GET /damages/:id': guarded('damages', 'read'),
  'POST /damages': guarded('damages', 'create'),
  'PATCH /damages/:id': guarded('damages', 'update'),
  'PATCH /damages/:id/status': guarded('damages', 'update'),
  'POST /damages/:id/archive': guarded('damages', 'update'),
  'POST /damages/:id/restore': guarded('damages', 'update'),
  'POST /damages/:id/convert-to-maintenance': guarded('maintenance', 'create'),
  'DELETE /damages/:id': guarded('damages', 'delete'),

  // A notification is addressed to a person, not to a module, and every query
  // is scoped by the caller's own id.
  'GET /notifications': anyUser('Your own notifications.'),
  'GET /notifications/unread-count': anyUser('Your own unread count.'),
  'POST /notifications/:id/read': anyUser('Your own notification; 404 for anyone else’s.'),
  'POST /notifications/read-all': anyUser('Your own notifications.'),
  'POST /notifications/run': guarded('reports', 'read'),
  'POST /notifications/flush-email': guarded('reports', 'read'),
  'GET /notifications/delivery-health': guarded('reports', 'read'),

  'GET /dashboard': anyUser('Assembled per role; each section resolves its own scope.'),

  'GET /reports': guarded('reports', 'read'),
  'GET /reports/:name': guarded('reports', 'read'),
  'GET /reports/:name/export': guarded('reports', 'read'),
};

/** A plausible id for a path parameter, so the request reaches the guard. */
const PARAM_VALUES: Record<string, string> = {
  ':id': '00000000-0000-4000-8000-000000000001',
  ':name': 'cost-by-vehicle',
};

function concrete(path: string): string {
  return path.replace(/:[a-zA-Z]+/g, (match) => PARAM_VALUES[match] ?? 'placeholder');
}

/** Methods this suite drives. Narrowed so the supertest agent stays typed. */
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

function send(route: RegisteredRoute, token?: string) {
  const url = `/api/v1${concrete(route.path)}`;
  const method = route.method.toLowerCase() as Method;
  const agent = request(h.app);
  if (!(method in agent)) throw new Error(`Unsupported method ${route.method}`);

  const req = agent[method](url);
  // An empty JSON body, so a POST reaches the guard rather than failing at the
  // body parser and returning a status that proves nothing.
  return token ? req.set('Authorization', `Bearer ${token}`).send({}) : req.send({});
}

// ---------------------------------------------------------------------------
// 1. Completeness
// ---------------------------------------------------------------------------

describe('route inventory', () => {
  it('finds every registered route', () => {
    const routes = registeredRoutes(h.app);
    // A sanity floor: if the walker silently stops descending, this catches it
    // before the rest of the suite passes vacuously over three routes.
    expect(routes.length).toBeGreaterThanOrEqual(75);
  });

  it('classifies every registered route', () => {
    const unclassified = registeredRoutes(h.app)
      .map(routeKey)
      .filter((key) => !(key in EXPECTED));

    // The message names them, because "expected [] to equal [3 items]" is not
    // an actionable failure at half past five.
    expect(unclassified, `Unclassified routes:\n  ${unclassified.join('\n  ')}`).toEqual([]);
  });

  it('does not classify routes that no longer exist', () => {
    const live = new Set(registeredRoutes(h.app).map(routeKey));
    const stale = Object.keys(EXPECTED).filter((key) => !live.has(key));
    expect(stale, `Classified but not registered:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2 and 3. Denial and admission, per role, per route
// ---------------------------------------------------------------------------

const GUARDED_ROUTES = Object.entries(EXPECTED)
  .filter(([, value]) => value.kind === 'guarded')
  .map(([key, value]) => ({ key, ...(value as Guarded) }));

const CASES = USER_ROLES.flatMap((role) => GUARDED_ROUTES.map((route) => ({ role, ...route })));

describe('every guarded route × every role', () => {
  it('produces one case per route per role', () => {
    expect(CASES).toHaveLength(GUARDED_ROUTES.length * USER_ROLES.length);
  });

  it.each(CASES)('$role → $key', async ({ role, key, module, action }) => {
    const [method, ...rest] = key.split(' ');
    const route: RegisteredRoute = { method: method ?? 'GET', path: rest.join(' ') };
    const decision = can(role, module, action);

    const response = await send(route, h.token(role));

    if (decision.allowed) {
      // Anything but 403. A 422 or 404 means the request got past the guard,
      // which is what is being asserted; asserting 200 would require a valid
      // body for eighty endpoints and would test the fixtures instead.
      expect(response.status, `${role} ${key} → ${response.status}`).not.toBe(403);
    } else {
      expect(response.status, `${role} ${key} → ${response.status}`).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });
});

// ---------------------------------------------------------------------------
// Authentication, independent of the matrix
// ---------------------------------------------------------------------------

describe('authentication', () => {
  const PROTECTED = Object.entries(EXPECTED).filter(([, value]) => value.kind !== 'public');

  it.each(PROTECTED.map(([key]) => key))('%s requires a token', async (key) => {
    const [method, ...rest] = key.split(' ');
    const response = await send({ method: method ?? 'GET', path: rest.join(' ') });
    // 401, never 403: "I don't know who you are" is a different answer from
    // "I know, and no", and conflating them makes both untestable.
    expect(response.status, `${key} → ${response.status}`).toBe(401);
  });

  it.each(PROTECTED.map(([key]) => key))('%s rejects a forged token', async (key) => {
    const [method, ...rest] = key.split(' ');
    // A structurally valid JWT signed with the wrong key. The signature check
    // is the only thing standing between this and full access.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiQURNSU4iLCJkcml2ZXJJZCI6bnVsbCwianRpIjoieCIsImV4cCI6NDEwMjQ0NDgwMCwiaWF0TXMiOjE3NTUwMDAwMDAwMDB9.' +
      'ZmFrZS1zaWduYXR1cmU';
    const response = await send({ method: method ?? 'GET', path: rest.join(' ') }, forged);
    expect(response.status, `${key} → ${response.status}`).toBe(401);
  });
});

describe('routes open by design', () => {
  const PUBLIC = Object.entries(EXPECTED).filter(
    ([key, value]) =>
      value.kind === 'public' &&
      // Refresh is the one exception and gets its own test below: it needs no
      // *bearer* token but does need its cookie, so with neither it correctly
      // answers 401 — which is the opposite of what this assertion checks.
      key !== 'POST /auth/refresh',
  );

  it.each(PUBLIC.map(([key, value]) => [key, (value as Public).why]))(
    '%s is reachable without a token — %s',
    async (key) => {
      const [method, ...rest] = key.split(' ');
      const response = await send({ method: method ?? 'GET', path: rest.join(' ') });
      // Whatever it answers, it must not be an authentication failure.
      expect(response.status, `${key} → ${response.status}`).not.toBe(401);
    },
  );

  it('POST /auth/refresh is authenticated by its cookie, not a bearer token', async () => {
    const withNothing = await request(h.app).post('/api/v1/auth/refresh').send({});
    expect(withNothing.status).toBe(401);

    const signIn = await request(h.app)
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTS.ADMIN, password: PASSWORD });
    const cookie = signIn.headers['set-cookie'] as unknown as string[];

    // No Authorization header anywhere in this request — the cookie alone is
    // the credential, which is what makes the session survive a page reload
    // without the access token ever being written to storage.
    const withCookie = await request(h.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .send({});
    expect(withCookie.status).toBe(200);
    expect(withCookie.body.accessToken).toBeTruthy();
  });
});
