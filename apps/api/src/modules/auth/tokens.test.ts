/**
 * Access-token unit tests — FF-201.
 *
 * Refresh-token storage needs Redis and is covered in the integration suite.
 */

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { UnauthenticatedError } from '../../platform/errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type AccessTokenSubject,
} from './tokens.js';

const SUBJECT: AccessTokenSubject = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'FLEET_MANAGER',
  driverId: null,
};

const SECRET = process.env['JWT_SECRET'] ?? '';

/** Builds a token directly, bypassing our signer, to forge specific claims. */
function forge(payload: object, options: jwt.SignOptions = {}, secret = SECRET): string {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    subject: SUBJECT.id,
    jwtid: 'forged',
    issuer: 'fleetflow',
    audience: 'fleetflow-api',
    expiresIn: 900,
    ...options,
  });
}

describe('signing and verifying', () => {
  it('round-trips the claims authorisation depends on', () => {
    const { token } = signAccessToken(SUBJECT);
    const claims = verifyAccessToken(token);

    expect(claims.id).toBe(SUBJECT.id);
    expect(claims.role).toBe('FLEET_MANAGER');
    expect(claims.driverId).toBeNull();
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('carries a driver id when the account is linked to one', () => {
    const driverId = '00000000-0000-4000-8000-000000000101';
    const { token } = signAccessToken({ ...SUBJECT, role: 'DRIVER', driverId });
    expect(verifyAccessToken(token).driverId).toBe(driverId);
  });

  it('issues a distinct jti per token so FF-202 can revoke one session', () => {
    expect(signAccessToken(SUBJECT).jti).not.toBe(signAccessToken(SUBJECT).jti);
  });

  it('reports its lifetime in seconds', () => {
    expect(signAccessToken(SUBJECT).expiresIn).toBe(15 * 60);
  });

  it('signs with HS256 and nothing else', () => {
    const { token } = signAccessToken(SUBJECT);
    const header = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(header['alg']).toBe('HS256');
  });
});

describe('rejection', () => {
  it('rejects a tampered payload', () => {
    const { token } = signAccessToken(SUBJECT);
    const [header, payload, signature] = token.split('.');

    // Re-encode the payload with an escalated role, keeping the old signature.
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as {
      role: string;
    };
    decoded.role = 'ADMIN';
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow(
      UnauthenticatedError,
    );
  });

  it('rejects a token signed with a different secret', () => {
    const foreign = forge(
      { role: 'ADMIN', driverId: null },
      {},
      'an-attackers-secret-that-is-long-enough',
    );
    expect(() => verifyAccessToken(foreign)).toThrow(UnauthenticatedError);
  });

  it('rejects an unsigned `alg: none` token', () => {
    // The classic attack. Our verifier passes algorithms: ['HS256'], so a
    // token asserting its own algorithm is refused rather than trusted.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: SUBJECT.id,
        role: 'ADMIN',
        driverId: null,
        jti: 'x',
        iss: 'fleetflow',
        aud: 'fleetflow-api',
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow(UnauthenticatedError);
  });

  it('rejects a token from another issuer or audience', () => {
    expect(() =>
      verifyAccessToken(
        forge({ role: 'ADMIN', driverId: null }, { audience: 'some-other-service' }),
      ),
    ).toThrow(UnauthenticatedError);

    expect(() =>
      verifyAccessToken(forge({ role: 'ADMIN', driverId: null }, { issuer: 'not-fleetflow' })),
    ).toThrow(UnauthenticatedError);
  });

  it('rejects an expired token, and says so', () => {
    const expired = forge({ role: 'ADMIN', driverId: null }, { expiresIn: -60 });
    // The client needs to tell "refresh me" apart from "log in again".
    expect(() => verifyAccessToken(expired)).toThrow(/expired/i);
  });

  it('rejects a correctly signed token whose claims are the wrong shape', () => {
    // Signed by us, but 'SUPERUSER' is not a role. Being signed is necessary,
    // not sufficient — the claims drive authorisation.
    expect(() => verifyAccessToken(forge({ role: 'SUPERUSER', driverId: null }))).toThrow(
      /malformed/i,
    );

    // Same for a subject that is not a uuid.
    expect(() =>
      verifyAccessToken(forge({ role: 'ADMIN', driverId: null }, { subject: 'not-a-uuid' })),
    ).toThrow(/malformed/i);
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects garbage: %s', (garbage) => {
    expect(() => verifyAccessToken(garbage)).toThrow(UnauthenticatedError);
  });
});

describe('refresh tokens', () => {
  it('are opaque, unguessable and unique', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(200);
    // 32 bytes base64url — no padding, url-safe alphabet.
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('are stored as a hash, never in the clear', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    // Deterministic, so a presented token can be looked up.
    expect(hashRefreshToken(token)).toBe(hash);
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(hash);
  });
});
