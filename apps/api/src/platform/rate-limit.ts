/**
 * Rate limiting and account lockout — FF-205, AUTH-05.
 *
 * Two mechanisms, aimed at different attacks:
 *
 *   Rate limit  per IP, per endpoint. Blunts a machine hammering the login form
 *               with a credential-stuffing list.
 *   Lockout     per account. Blunts a slow, distributed guess at one password,
 *               which no per-IP limit would ever notice.
 *
 * Both live in Redis, so limits hold across API instances and survive a
 * restart. An in-process counter would reset on every deploy — which is exactly
 * when an attacker gets a free run.
 */

import type { RequestHandler } from 'express';
import { RateLimitedError } from './errors.js';
import { childLogger } from './logger.js';
import { redis } from './redis.js';

const log = childLogger('rate-limit');

// ---------------------------------------------------------------------------
// Sliding-window rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Distinguishes one limiter from another in Redis. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Defaults to the client IP. */
  keyFor?: (req: Parameters<RequestHandler>[0]) => string;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Sliding window over a Redis sorted set: one member per hit, scored by
 * timestamp, with everything older than the window trimmed before counting.
 *
 * A fixed window (`INCR` + `EXPIRE`) is cheaper but lets through twice the
 * limit across a boundary — 20 attempts at 09:59:59 and 20 more at 10:00:01.
 * For a login endpoint that doubling is the whole attack.
 */
export async function consumeRateLimit(
  name: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  const key = `ratelimit:${name}:${identity}`;
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, windowStart)
    .zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 10)}`)
    .zcard(key)
    .expire(key, windowSeconds)
    .exec();

  // results[2] is the ZCARD reply: [error, value].
  const count = Number(results?.[2]?.[1] ?? 0);
  const allowed = count <= limit;

  if (!allowed) {
    // The oldest hit in the window determines when a slot frees up.
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = Number(oldest[1] ?? now);
    const retryAfter = Math.max(1, Math.ceil((oldestScore + windowSeconds * 1000 - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  return { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 };
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    // `req.ip` is only trustworthy because app.ts sets `trust proxy`; without
    // that every request behind a proxy shares one address and one bucket.
    const identity = options.keyFor?.(req) ?? req.ip ?? 'unknown';

    void (async () => {
      try {
        const verdict = await consumeRateLimit(
          options.name,
          identity,
          options.limit,
          options.windowSeconds,
        );

        res.setHeader('X-RateLimit-Limit', String(options.limit));
        res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));

        if (!verdict.allowed) {
          res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
          log.warn({ limiter: options.name, identity }, 'Rate limit exceeded');
          next(
            new RateLimitedError(
              `Too many requests. Try again in ${verdict.retryAfterSeconds} seconds.`,
            ),
          );
          return;
        }

        next();
      } catch (error) {
        // Redis being unavailable must not take the API down with it. The limit
        // is a mitigation, not an authorisation decision — failing open here is
        // the lesser harm, and the outage is already visible in /healthz.
        log.error({ err: error, limiter: options.name }, 'Rate limiter unavailable — allowing');
        next();
      }
    })();
  };
}

// ---------------------------------------------------------------------------
// Progressive account lockout
// ---------------------------------------------------------------------------

const LOCKOUT_PREFIX = 'lockout:';
const FAILURE_PREFIX = 'authfail:';

/** Failures are forgotten after this long without another one. */
const FAILURE_WINDOW_SECONDS = 15 * 60;

/** Attempts allowed before the first lock. */
const FREE_ATTEMPTS = 5;

/**
 * Lock duration by how many times the threshold has been crossed. Doubling
 * makes an online guessing attack uneconomic within a few rounds, while a user
 * who genuinely mistypes twice is never locked at all.
 */
const LOCK_LADDER_SECONDS = [60, 300, 900, 3600];

export interface LockoutState {
  locked: boolean;
  retryAfterSeconds: number;
  failures: number;
}

function failureKey(identity: string): string {
  return `${FAILURE_PREFIX}${identity.toLowerCase()}`;
}

function lockKey(identity: string): string {
  return `${LOCKOUT_PREFIX}${identity.toLowerCase()}`;
}

export async function checkLockout(identity: string): Promise<LockoutState> {
  const ttl = await redis.ttl(lockKey(identity));
  if (ttl > 0) {
    const failures = Number((await redis.get(failureKey(identity))) ?? 0);
    return { locked: true, retryAfterSeconds: ttl, failures };
  }
  return { locked: false, retryAfterSeconds: 0, failures: 0 };
}

/**
 * Records a failed attempt and locks the account once the threshold is crossed.
 *
 * Keyed by email address, so the lock follows the account across IP addresses.
 * That is the point — an attacker distributing guesses across a botnet defeats
 * per-IP limiting entirely.
 */
export async function recordAuthFailure(identity: string): Promise<LockoutState> {
  const key = failureKey(identity);
  const failures = await redis.incr(key);
  await redis.expire(key, FAILURE_WINDOW_SECONDS);

  if (failures <= FREE_ATTEMPTS) {
    return { locked: false, retryAfterSeconds: 0, failures };
  }

  const step = Math.min(failures - FREE_ATTEMPTS - 1, LOCK_LADDER_SECONDS.length - 1);
  const duration = LOCK_LADDER_SECONDS[step] ?? LOCK_LADDER_SECONDS[LOCK_LADDER_SECONDS.length - 1];

  await redis.set(lockKey(identity), '1', 'EX', duration ?? 60);
  log.warn({ identity, failures, lockedForSeconds: duration }, 'Account locked after failures');

  return { locked: true, retryAfterSeconds: duration ?? 60, failures };
}

/** Called after a successful sign-in, so a good password wipes the slate. */
export async function clearAuthFailures(identity: string): Promise<void> {
  await redis.del(failureKey(identity), lockKey(identity));
}

/**
 * Test seam: clears every limiter and lockout.
 *
 * Rate limiting is deliberately stateful across requests, which is exactly what
 * makes it awkward for a test suite that signs in dozens of times from one
 * address. Suites call this in setup so each run starts from a clean slate
 * rather than inheriting the previous run's counters.
 *
 * Uses SCAN rather than KEYS: KEYS blocks the server for the length of the
 * sweep, and this must never be reachable from production code by accident.
 */
export async function resetRateLimits(): Promise<void> {
  for (const pattern of ['ratelimit:*', `${FAILURE_PREFIX}*`, `${LOCKOUT_PREFIX}*`]) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  }
}
