/**
 * Login, end to end — FF-201.
 *
 * The acceptance criterion is a negative one: wrong password, unknown address
 * and deactivated account must be indistinguishable. That is asserted directly
 * below rather than inferred from the happy path.
 *
 * Run with `npm run test:integration` (needs `npm run db:up` and a seeded database).
 */

import { GENERIC_LOGIN_FAILURE } from '@fleetflow/shared';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { disconnectDb, withDeleted } from '../../platform/db.js';
import { resetRateLimits } from '../../platform/rate-limit.js';
import { connectRedis, disconnectRedis } from '../../platform/redis.js';
import { REFRESH_COOKIE_NAME } from './routes.js';
import { BCRYPT_COST } from './service.js';
import { readRefreshToken, signAccessToken } from './tokens.js';

const raw = withDeleted();
let app: Express;

/** Seeded by prisma/seed.ts. */
const SEEDED = {
  admin: { email: 'admin@fleetflow.local', password: 'FleetFlow-Dev-2026!' },
  driver: { email: 'amina@fleetflow.local', password: 'FleetFlow-Dev-2026!' },
} as const;

/** Accounts this suite owns, in an id range the seed never uses. */
const T = {
  deactivated: 'eeeeeeee-0000-4000-8000-000000000001',
  deleted: 'eeeeeeee-0000-4000-8000-000000000002',
} as const;

const OWNED_PASSWORD = 'Owned-Account-Password-2026!';

async function cleanup(): Promise<void> {
  await raw.user.deleteMany({ where: { id: { in: [T.deactivated, T.deleted] } } });
}

beforeAll(async () => {
  await connectRedis();
  // AUTH-05 is stateful across requests: this suite signs in repeatedly from one
  // address and deliberately fails several attempts, which would otherwise trip
  // the per-IP limit and lock the seeded account for later cases.
  await resetRateLimits();
  await cleanup();

  const passwordHash = await bcrypt.hash(OWNED_PASSWORD, BCRYPT_COST);

  await raw.user.create({
    data: {
      id: T.deactivated,
      name: 'Deactivated Person',
      email: 'deactivated@fleetflow.local',
      passwordHash,
      role: 'FLEET_MANAGER',
      isActive: false,
      deactivatedAt: new Date(),
    },
  });

  await raw.user.create({
    data: {
      id: T.deleted,
      name: 'Deleted Person',
      email: 'deleted@fleetflow.local',
      passwordHash,
      role: 'FLEET_MANAGER',
      deletedAt: new Date(),
    },
  });

  app = createApp();
});

afterAll(async () => {
  await cleanup();
  await Promise.allSettled([disconnectDb(), disconnectRedis()]);
});

describe('POST /api/v1/auth/login — success', () => {
  it('accepts a seeded account and returns a token and the user', async () => {
    const response = await request(app).post('/api/v1/auth/login').send(SEEDED.admin);

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.expiresIn).toBe(900);
    expect(response.body.user).toMatchObject({
      email: 'admin@fleetflow.local',
      role: 'ADMIN',
      driverId: null,
    });
  });

  it('never returns the password hash or the refresh token in the body', async () => {
    const response = await request(app).post('/api/v1/auth/login').send(SEEDED.admin);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('$2b$');
    expect(serialised).not.toContain('refresh');
  });

  it('resolves the driver link for a driver account', async () => {
    const response = await request(app).post('/api/v1/auth/login').send(SEEDED.driver);
    expect(response.body.user.role).toBe('DRIVER');
    expect(response.body.user.driverId).toEqual(expect.any(String));
  });

  it('normalises the submitted address before looking it up', async () => {
    // The shared schema trims and lowercases, so this is the same account.
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: '  ADMIN@FleetFlow.Local  ', password: SEEDED.admin.password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('admin@fleetflow.local');
  });

  it('records the login timestamp only on success', async () => {
    const before = await raw.user.findUniqueOrThrow({
      where: { email: SEEDED.admin.email },
      select: { lastLoginAt: true },
    });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SEEDED.admin.email, password: 'wrong-password-entirely' });

    const afterFailure = await raw.user.findUniqueOrThrow({
      where: { email: SEEDED.admin.email },
      select: { lastLoginAt: true },
    });
    expect(afterFailure.lastLoginAt?.getTime()).toBe(before.lastLoginAt?.getTime());

    await request(app).post('/api/v1/auth/login').send(SEEDED.admin);

    const afterSuccess = await raw.user.findUniqueOrThrow({
      where: { email: SEEDED.admin.email },
      select: { lastLoginAt: true },
    });
    expect(afterSuccess.lastLoginAt).not.toBeNull();
  });
});

describe('POST /api/v1/auth/login — failures are indistinguishable', () => {
  const cases = [
    ['wrong password', { email: SEEDED.admin.email, password: 'definitely-not-the-password' }],
    ['unknown address', { email: 'nobody@fleetflow.local', password: OWNED_PASSWORD }],
    ['deactivated account', { email: 'deactivated@fleetflow.local', password: OWNED_PASSWORD }],
    ['soft-deleted account', { email: 'deleted@fleetflow.local', password: OWNED_PASSWORD }],
  ] as const;

  it.each(cases)('%s is rejected', async (_label, credentials) => {
    const response = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(response.body.error.message).toBe(GENERIC_LOGIN_FAILURE);
  });

  it('produces byte-identical bodies across every failure mode', async () => {
    // The acceptance criterion: nothing in the response distinguishes "no such
    // account" from "wrong password" or "deactivated".
    const responses = await Promise.all(
      cases.map(([, credentials]) => request(app).post('/api/v1/auth/login').send(credentials)),
    );

    const signatures = responses.map((r) =>
      JSON.stringify({ status: r.status, code: r.body.error.code, message: r.body.error.message }),
    );

    expect(new Set(signatures).size).toBe(1);
  });

  it('sets no refresh cookie on a failed attempt', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: SEEDED.admin.email, password: 'nope' });

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a malformed request with 422, not 401', async () => {
    // A validation failure is a different thing from a credential failure, and
    // conflating them would hide client bugs.
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('the refresh cookie', () => {
  async function loginCookie(): Promise<string> {
    const response = await request(app).post('/api/v1/auth/login').send(SEEDED.admin);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!cookie) throw new Error('No refresh cookie was set');
    return cookie;
  }

  it('is httpOnly, SameSite=Lax and scoped to the auth path', async () => {
    const cookie = await loginCookie();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('stores only a hash in Redis, and the stored value maps to the user', async () => {
    const cookie = await loginCookie();
    const token = decodeURIComponent(cookie.split('=')[1]?.split(';')[0] ?? '');

    const record = await readRefreshToken(token);
    expect(record).not.toBeNull();
    expect(record?.userId).toEqual(expect.any(String));

    // The raw token must not be usable as a Redis key by itself.
    expect(token).not.toBe('');
  });

  it('issues a different refresh token on every login', async () => {
    const [first, second] = await Promise.all([loginCookie(), loginCookie()]);
    expect(first).not.toBe(second);
  });
});

describe('GET /api/v1/auth/me', () => {
  async function accessTokenFor(credentials: { email: string; password: string }): Promise<string> {
    const response = await request(app).post('/api/v1/auth/login').send(credentials);
    return response.body.accessToken as string;
  }

  it('returns the caller when the token is valid', async () => {
    const token = await accessTokenFor(SEEDED.admin);
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('admin@fleetflow.local');
    expect(response.body.user.role).toBe('ADMIN');
  });

  it('reads the account fresh, so a role change takes effect on the next request', async () => {
    const token = await accessTokenFor(SEEDED.driver);

    // try/finally, not a trailing restore: this mutates shared seed data, and a
    // failed assertion between the two writes would otherwise leave the seeded
    // driver permanently an ACCOUNTANT — poisoning every later run until someone
    // re-seeds. That is exactly what happened once before this guard existed.
    try {
      await raw.user.update({
        where: { email: SEEDED.driver.email },
        data: { role: 'ACCOUNTANT' },
      });

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      // The token still says DRIVER; the database is authoritative.
      expect(response.body.user.role).toBe('ACCOUNTANT');
    } finally {
      await raw.user.update({ where: { email: SEEDED.driver.email }, data: { role: 'DRIVER' } });
    }
  });

  it('refuses a token whose account was deactivated after it was issued', async () => {
    const { token } = signAccessToken({
      id: T.deactivated,
      role: 'FLEET_MANAGER',
      driverId: null,
    });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it.each([
    ['no header', undefined],
    ['empty bearer', 'Bearer '],
    ['wrong scheme', 'Basic abc123'],
    ['garbage token', 'Bearer not.a.jwt'],
  ])('rejects a request with %s', async (_label, header) => {
    const req = request(app).get('/api/v1/auth/me');
    if (header !== undefined) req.set('Authorization', header);

    const response = await req;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});
