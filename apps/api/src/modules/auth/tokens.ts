/**
 * Token issuing and verification — FF-201.
 *
 * Two tokens with different jobs:
 *
 *   Access token   a short-lived signed JWT carrying identity and role. Sent as
 *                  a Bearer header, readable by the client, verified on every
 *                  request without a database round trip.
 *
 *   Refresh token  a long-lived opaque random value. Carries no claims and
 *                  means nothing on its own — it is a lookup key into Redis, so
 *                  it can be revoked, which is what makes logout real (AUTH-04).
 *
 * The access token deliberately expires in minutes: it cannot be revoked before
 * it expires, so its blast radius is bounded by its lifetime. Everything that
 * needs revocability lives on the refresh side.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { USER_ROLES, type UserRole } from '@fleetflow/shared';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { loadEnv } from '../../platform/env.js';
import { UnauthenticatedError } from '../../platform/errors.js';
import { redis } from '../../platform/redis.js';

const env = loadEnv();

/**
 * Pinned, and always passed to `verify` as an explicit allowlist.
 *
 * Never rely on the default. Accepting whatever algorithm the token's own
 * header names is the classic JWT failure: a token claiming `alg: none`, or an
 * RS256 token verified against its public key as if it were an HMAC secret,
 * both authenticate as valid. jsonwebtoken v9 hardened its defaults against
 * this, but the protection then depends on the version and on the secret's
 * type — stating the allowlist here makes it depend on neither.
 */
const ALGORITHM = 'HS256' as const;
const ISSUER = 'fleetflow';
const AUDIENCE = 'fleetflow-api';

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

export interface AccessTokenSubject {
  id: string;
  role: UserRole;
  driverId: string | null;
}

export interface AccessTokenClaims extends AccessTokenSubject {
  /** Unique per token. FF-202 uses it to revoke a live token on logout. */
  jti: string;
  expiresAt: Date;
  /** When the token was signed. Compared against the per-user cutoff (USR-02). */
  issuedAt: Date;
}

/** The shape a verified payload must have before it is trusted. */
const accessPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(USER_ROLES),
  driverId: z.string().uuid().nullable(),
  jti: z.string().min(1),
  exp: z.number().int().positive(),
  /**
   * Issued-at in **milliseconds**, ours rather than the standard `iat`.
   *
   * `iat` is a whole number of seconds, which is too coarse for the per-user
   * cutoff below: a token refreshed in the same second as a role change is
   * indistinguishable from one issued before it, so either freshly minted
   * tokens get rejected (a refresh loop) or stale authority survives. A
   * millisecond claim removes the ambiguity instead of picking which way to be
   * wrong.
   */
  iatMs: z.number().int().positive(),
});

export function accessTokenTtlSeconds(): number {
  return env.accessTokenTtlMinutes * 60;
}

export function signAccessToken(subject: AccessTokenSubject): {
  token: string;
  expiresIn: number;
  jti: string;
} {
  const jti = randomUUID();
  const expiresIn = accessTokenTtlSeconds();

  const token = jwt.sign(
    { role: subject.role, driverId: subject.driverId, iatMs: Date.now() },
    env.jwtSecret,
    {
      algorithm: ALGORITHM,
      expiresIn,
      subject: subject.id,
      jwtid: jti,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
  );

  return { token, expiresIn, jti };
}

/**
 * Verifies signature, algorithm, issuer, audience and expiry, then checks the
 * payload's shape.
 *
 * The second step is not redundant. A signature proves the token came from us;
 * it says nothing about whether the claims are ones we would ever have issued.
 * Since `role` drives every authorisation decision, a token we signed but whose
 * role is not in USER_ROLES is rejected rather than trusted.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  let payload: unknown;

  try {
    payload = jwt.verify(token, env.jwtSecret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Distinguished from a bad signature so the client knows to refresh
      // rather than to send the user back to the login screen.
      throw new UnauthenticatedError('The access token has expired.');
    }
    throw new UnauthenticatedError('The access token is invalid.');
  }

  const parsed = accessPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthenticatedError('The access token is malformed.');
  }

  return {
    id: parsed.data.sub,
    role: parsed.data.role,
    driverId: parsed.data.driverId,
    jti: parsed.data.jti,
    expiresAt: new Date(parsed.data.exp * 1000),
    issuedAt: new Date(parsed.data.iatMs),
  };
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

const REFRESH_BYTES = 32;
const REFRESH_KEY_PREFIX = 'refresh:';
/** Marks a token that has already been rotated — see `consumeRefreshToken`. */
const REFRESH_USED_PREFIX = 'refresh:used:';
/** Every live refresh-token hash for one user, so all sessions can be dropped at once. */
const SESSION_SET_PREFIX = 'user:sessions:';
/** Revoked access tokens, by jti, until they would have expired anyway. */
const DENYLIST_PREFIX = 'access:denied:';

export function refreshTokenTtlSeconds(): number {
  return env.refreshTokenTtlDays * 24 * 60 * 60;
}

/** 256 bits from the CSPRNG. Opaque: it encodes nothing and proves nothing alone. */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_BYTES).toString('base64url');
}

/**
 * Redis stores the hash, never the token.
 *
 * Same reasoning as `password_resets.token_hash`: whoever can read the store
 * must not thereby be able to impersonate every logged-in user. SHA-256 without
 * a salt is right here — the input is already 256 bits of entropy, so there is
 * no dictionary to attack and no reason to pay bcrypt's cost on every request.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshKey(hash: string): string {
  return `${REFRESH_KEY_PREFIX}${hash}`;
}

function usedKey(hash: string): string {
  return `${REFRESH_USED_PREFIX}${hash}`;
}

function sessionSetKey(userId: string): string {
  return `${SESSION_SET_PREFIX}${userId}`;
}

export interface RefreshRecord {
  userId: string;
  issuedAt: string;
}

export async function storeRefreshToken(token: string, userId: string): Promise<void> {
  const hash = hashRefreshToken(token);
  const record: RefreshRecord = { userId, issuedAt: new Date().toISOString() };
  const ttl = refreshTokenTtlSeconds();

  // The Redis TTL is the authority on refresh-token lifetime: an abandoned
  // session expires on its own rather than accumulating. The set membership is
  // what makes "sign out everywhere" possible later.
  await redis
    .multi()
    .set(refreshKey(hash), JSON.stringify(record), 'EX', ttl)
    .sadd(sessionSetKey(userId), hash)
    .expire(sessionSetKey(userId), ttl)
    .exec();
}

export async function readRefreshToken(token: string): Promise<RefreshRecord | null> {
  const raw = await redis.get(refreshKey(hashRefreshToken(token)));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RefreshRecord;
  } catch {
    return null;
  }
}

export type ConsumeOutcome =
  | { outcome: 'ok'; userId: string }
  /** Presented a token that was already rotated — see below. */
  | { outcome: 'reused'; userId: string }
  | { outcome: 'unknown' };

/**
 * Single-use redemption: reads the token, deletes it, and remembers that it was
 * used — atomically, so two concurrent refreshes cannot both succeed.
 *
 * **Why the `used` marker matters.** With rotation, a refresh token is valid
 * exactly once. If one is presented a second time, either the client raced
 * itself, or somebody stole it — and the two are indistinguishable from here.
 * The safe reading is theft: an attacker who copied the cookie will replay it,
 * and without this check they would silently hold a parallel session for as
 * long as they kept refreshing.
 *
 * So a reuse is reported to the caller, which drops every session for that user
 * (see `revokeAllSessions`). The legitimate user is signed out and must log in
 * again; the attacker's copy dies with it. Being logged out occasionally beats
 * an undetectable session hijack.
 */
export async function consumeRefreshToken(token: string): Promise<ConsumeOutcome> {
  const hash = hashRefreshToken(token);
  const raw = await redis.get(refreshKey(hash));

  if (!raw) {
    const previousOwner = await redis.get(usedKey(hash));
    if (previousOwner) return { outcome: 'reused', userId: previousOwner };
    return { outcome: 'unknown' };
  }

  let record: RefreshRecord;
  try {
    record = JSON.parse(raw) as RefreshRecord;
  } catch {
    return { outcome: 'unknown' };
  }

  await redis
    .multi()
    .del(refreshKey(hash))
    // Remembered for the token's full remaining life so a late replay is still
    // recognised as reuse rather than as an unknown token.
    .set(usedKey(hash), record.userId, 'EX', refreshTokenTtlSeconds())
    .srem(sessionSetKey(record.userId), hash)
    .exec();

  return { outcome: 'ok', userId: record.userId };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const hash = hashRefreshToken(token);
  const raw = await redis.get(refreshKey(hash));

  let userId: string | undefined;
  if (raw) {
    try {
      userId = (JSON.parse(raw) as RefreshRecord).userId;
    } catch {
      userId = undefined;
    }
  }

  const pipeline = redis.multi().del(refreshKey(hash));
  if (userId) pipeline.srem(sessionSetKey(userId), hash);
  await pipeline.exec();
}

/** Drops every live session for a user. Used on refresh-token reuse. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const hashes = await redis.smembers(sessionSetKey(userId));
  const pipeline = redis.multi();
  for (const hash of hashes) pipeline.del(refreshKey(hash));
  pipeline.del(sessionSetKey(userId));
  await pipeline.exec();
  return hashes.length;
}

export async function countSessions(userId: string): Promise<number> {
  return redis.scard(sessionSetKey(userId));
}

// ---------------------------------------------------------------------------
// Access-token revocation — AUTH-04
// ---------------------------------------------------------------------------

/**
 * A JWT is valid until it expires; nothing in the token itself can withdraw
 * that. Without a denylist, "log out" would only clear client state, and a
 * copied token would keep working for the rest of its 15 minutes — which is
 * precisely what AUTH-04's acceptance criterion forbids.
 *
 * The entry lives exactly as long as the token would have, so the list stays
 * small and self-cleaning: it can never hold more than 15 minutes of logouts.
 */
export async function denyAccessToken(jti: string, expiresAt: Date): Promise<void> {
  const secondsRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
  if (secondsRemaining <= 0) return; // already expired; nothing to revoke
  await redis.set(`${DENYLIST_PREFIX}${jti}`, '1', 'EX', secondsRemaining);
}

export async function isAccessTokenDenied(jti: string): Promise<boolean> {
  return (await redis.exists(`${DENYLIST_PREFIX}${jti}`)) === 1;
}

// ---------------------------------------------------------------------------
// Per-user access cutoff — USR-02, USR-03
// ---------------------------------------------------------------------------

/** Marks the instant before which a user's access tokens are no longer honoured. */
const ACCESS_CUTOFF_PREFIX = 'auth:cutoff:';

/**
 * Retires every access token this user currently holds.
 *
 * **Why a cutoff rather than a denylist entry.** The denylist is keyed by `jti`,
 * which requires knowing the tokens — and a role change happens in an
 * administrator's request, which knows nothing about the sessions the affected
 * user has open, possibly on several devices. One timestamp per user covers all
 * of them, present and unknown.
 *
 * **Why access tokens only.** The refresh cookie deliberately survives. The
 * user's next call fails with 401, the client's existing refresh-and-retry path
 * fires, and a token is issued carrying the *new* role — so the change takes
 * effect on the next request, as USR-02's acceptance criterion requires, and the
 * user is not signed out to achieve it. Revoking the refresh token instead would
 * dump everyone back at the login screen every time an administrator corrected a
 * role.
 *
 * This matters most in the other direction: without it, demoting an
 * administrator or deactivating a departing employee leaves their existing token
 * fully privileged for up to a further 15 minutes.
 *
 * The key expires after one access-token lifetime because every token issued
 * before the cutoff has expired on its own by then.
 */
export async function revokeAccessTokensFor(userId: string): Promise<void> {
  await redis.set(
    `${ACCESS_CUTOFF_PREFIX}${userId}`,
    Date.now().toString(),
    'EX',
    accessTokenTtlSeconds() + 60,
  );
}

/**
 * True when this token was issued before its owner's cutoff.
 *
 * Millisecond precision on both sides, so a token refreshed immediately after a
 * role change is correctly seen as newer. `<=` rather than `<` because an exact
 * tie cannot be ordered, and the safe reading of an ambiguous case is "stale" —
 * the cost is one extra refresh, the cost of the other choice is a stale role.
 */
export async function isAccessTokenStale(claims: AccessTokenClaims): Promise<boolean> {
  const cutoff = await redis.get(`${ACCESS_CUTOFF_PREFIX}${claims.id}`);
  if (!cutoff) return false;
  return claims.issuedAt.getTime() <= Number(cutoff);
}
