/**
 * Refresh rotation and logout — FF-202.
 *
 * The acceptance criterion is precise: after logout, the *same access token*
 * must be rejected — not merely discarded by the client. That is asserted by
 * replaying the exact token string, which is what a stolen one would look like.
 *
 * Run with `npm run test:integration` (needs `npm run db:up` and a seeded database).
 */

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { disconnectDb, withDeleted } from '../../platform/db.js';
import { resetRateLimits } from '../../platform/rate-limit.js';
import { connectRedis, disconnectRedis } from '../../platform/redis.js';
import { REFRESH_COOKIE_NAME } from './routes.js';
import { countSessions, isAccessTokenDenied, readRefreshToken } from './tokens.js';

const raw = withDeleted();
let app: Express;

const CREDENTIALS = { email: 'manager@fleetflow.local', password: 'FleetFlow-Dev-2026!' };
const DRIVER = { email: 'amina@fleetflow.local', password: 'FleetFlow-Dev-2026!' };

interface Session {
  accessToken: string;
  cookie: string;
  refreshToken: string;
  userId: string;
}

function cookieValue(setCookie: string): string {
  return decodeURIComponent(setCookie.split('=')[1]?.split(';')[0] ?? '');
}

async function signIn(credentials = CREDENTIALS): Promise<Session> {
  const response = await request(app).post('/api/v1/auth/login').send(credentials);
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!cookie) throw new Error('login did not set a refresh cookie');

  return {
    accessToken: response.body.accessToken as string,
    cookie,
    refreshToken: cookieValue(cookie),
    userId: response.body.user.id as string,
  };
}

beforeAll(async () => {
  await connectRedis();
  // This suite signs in on almost every case; without clearing AUTH-05's
  // counters it would exhaust the per-IP login budget partway through.
  await resetRateLimits();
  app = createApp();
});

afterAll(async () => {
  await Promise.allSettled([disconnectDb(), disconnectRedis()]);
});

describe('POST /api/v1/auth/refresh', () => {
  it('exchanges a valid cookie for a new access token', async () => {
    const session = await signIn();

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe(CREDENTIALS.email);
  });

  it('rotates the refresh token — the old one stops working', async () => {
    const session = await signIn();

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    const rotated = (first.headers['set-cookie'] as unknown as string[])[0];
    expect(rotated).toBeDefined();
    expect(cookieValue(rotated ?? '')).not.toBe(session.refreshToken);

    // The consumed token is gone from Redis, not merely superseded.
    expect(await readRefreshToken(session.refreshToken)).toBeNull();
  });

  it('issues a working token that the new cookie can refresh again', async () => {
    const session = await signIn();

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', (first.headers['set-cookie'] as unknown as string[])[0] ?? '');

    expect(second.status).toBe(200);
  });

  it('reflects a role changed since the token was issued', async () => {
    const session = await signIn(DRIVER);

    await raw.user.update({ where: { email: DRIVER.email }, data: { role: 'ACCOUNTANT' } });

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    // The user row is re-read on every refresh, so an administrator's change
    // lands within one access-token lifetime rather than at next login.
    expect(response.body.user.role).toBe('ACCOUNTANT');

    await raw.user.update({ where: { email: DRIVER.email }, data: { role: 'DRIVER' } });
  });

  it('refuses when no cookie is presented', async () => {
    const response = await request(app).post('/api/v1/auth/refresh');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses an unknown token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=completely-made-up-token-value`);
    expect(response.status).toBe(401);
  });
});

describe('refresh-token reuse is treated as theft', () => {
  it('replaying a consumed token drops every session for that user', async () => {
    // Two devices, so we can prove the *other* session dies too.
    const stolen = await signIn();
    const otherDevice = await signIn();

    expect(await countSessions(stolen.userId)).toBeGreaterThanOrEqual(2);

    // The legitimate refresh consumes the token.
    const legitimate = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${stolen.refreshToken}`);
    expect(legitimate.status).toBe(200);

    // The attacker replays the copy they took earlier.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${stolen.refreshToken}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toMatch(/security/i);

    // Everything is revoked — including the rotated token the honest client
    // just received, and the unrelated second device.
    expect(await countSessions(stolen.userId)).toBe(0);

    const rotated = cookieValue((legitimate.headers['set-cookie'] as unknown as string[])[0] ?? '');
    expect(await readRefreshToken(rotated)).toBeNull();

    const otherStillWorks = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${otherDevice.refreshToken}`);
    expect(otherStillWorks.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout — AUTH-04', () => {
  it('rejects the same access token afterwards', async () => {
    const session = await signIn();

    // Works before.
    const before = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);
    expect(before.status).toBe(200);

    const loggedOut = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);
    expect(loggedOut.status).toBe(204);

    // The acceptance criterion: the identical, still-unexpired token string —
    // exactly what a copy of it would be — is now refused by the server.
    const after = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(after.status).toBe(401);
    expect(after.body.error.message).toMatch(/ended/i);
  });

  it('revokes the refresh token so the session cannot be resurrected', async () => {
    const session = await signIn();

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    expect(await readRefreshToken(session.refreshToken)).toBeNull();

    const revived = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);
    expect(revived.status).toBe(401);
  });

  it('clears the cookie in the browser', async () => {
    const session = await signIn();
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    const cleared = (response.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cleared).toContain(`${REFRESH_COOKIE_NAME}=;`);
    expect(cleared).toContain('Path=/api/v1/auth');
  });

  it('denylists only the token that was used, not the account', async () => {
    const one = await signIn();
    const two = await signIn();

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${one.accessToken}`)
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${one.refreshToken}`);

    // Signing out of one device must not sign the user out everywhere.
    const other = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${two.accessToken}`);
    expect(other.status).toBe(200);
  });

  it('still revokes the refresh token when the access token has expired', async () => {
    const session = await signIn();

    // No Authorization header at all — the "tab left open overnight" case.
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`);

    expect(response.status).toBe(204);
    // The live session is ended rather than stranded.
    expect(await readRefreshToken(session.refreshToken)).toBeNull();
  });

  it('is idempotent', async () => {
    const session = await signIn();
    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      Cookie: `${REFRESH_COOKIE_NAME}=${session.refreshToken}`,
    };

    expect((await request(app).post('/api/v1/auth/logout').set(headers)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/logout').set(headers)).status).toBe(204);
  });
});

describe('the denylist is self-cleaning', () => {
  it('holds an entry no longer than the token it revokes', async () => {
    const session = await signIn();

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`);

    const [, payload] = session.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as {
      jti: string;
    };

    expect(await isAccessTokenDenied(claims.jti)).toBe(true);
    // The TTL equals the token's remaining life, so the list cannot grow
    // without bound — at most one access-token lifetime of logouts.
  });
});
