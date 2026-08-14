/**
 * Dashboard cache — FF-901.
 *
 * **Invalidation is a version counter, not a key sweep.**
 *
 * The cache key has to include the caller, because two roles looking at the same
 * fleet must not see each other's numbers. That means invalidating "the
 * dashboard" would mean deleting one key per user — and the only way to find
 * them is `KEYS dash:*` (which blocks Redis for the whole scan) or `SCAN` (which
 * is a loop that races the writes it is trying to invalidate).
 *
 * So the generation number is part of the key. A write anywhere in vehicles,
 * maintenance, documents or damages does one `INCR`, and every key from the
 * previous generation becomes unreachable at once — O(1), no scan, no race. The
 * orphaned entries are not deleted; their TTL disposes of them.
 *
 * **Redis being down must not take the dashboard with it.** Caching is a
 * performance requirement (NFR §5), not a correctness one. Every operation here
 * degrades to a miss, and the request goes to Postgres.
 */

import type { Dashboard } from '@fleetflow/shared';
import type { RequestHandler } from 'express';
import { redis } from '../../platform/redis.js';
import { childLogger } from '../../platform/logger.js';

const log = childLogger('dashboard-cache');

/** DSH acceptance names Redis and a cached view; five minutes is the plan's figure. */
export const DASHBOARD_TTL_SECONDS = 300;

const GENERATION_KEY = 'dash:generation';

/** Modules whose writes change at least one widget. */
export type DashboardDomain = 'vehicles' | 'maintenance' | 'documents' | 'damages';

async function currentGeneration(): Promise<string> {
  try {
    // A missing counter is generation 0, not an error: Redis starts empty.
    return (await redis.get(GENERATION_KEY)) ?? '0';
  } catch (error) {
    log.warn({ err: error }, 'Could not read the dashboard cache generation');
    return 'nocache';
  }
}

function cacheKey(generation: string, role: string, userId: string): string {
  return `dash:v${generation}:${role}:${userId}`;
}

export async function readCache(role: string, userId: string): Promise<Dashboard | null> {
  const generation = await currentGeneration();
  if (generation === 'nocache') return null;

  try {
    const raw = await redis.get(cacheKey(generation, role, userId));
    if (!raw) return null;
    // Trusted content — this process wrote it — so it is not re-validated
    // against the schema on every read, which would undo the point of caching.
    return JSON.parse(raw) as Dashboard;
  } catch (error) {
    log.warn({ err: error }, 'Dashboard cache read failed; serving from the database');
    return null;
  }
}

export async function writeCache(role: string, userId: string, value: Dashboard): Promise<void> {
  const generation = await currentGeneration();
  if (generation === 'nocache') return;

  try {
    await redis.set(
      cacheKey(generation, role, userId),
      JSON.stringify(value),
      'EX',
      DASHBOARD_TTL_SECONDS,
    );
  } catch (error) {
    log.warn({ err: error }, 'Dashboard cache write failed');
  }
}

/**
 * Retires every cached dashboard.
 *
 * Called after a write, never before: invalidating first would let a concurrent
 * read repopulate the new generation with pre-write numbers, which is the one
 * ordering that produces a cache entry that is wrong for a full five minutes.
 */
export async function invalidateDashboard(domain: DashboardDomain): Promise<void> {
  try {
    const generation = await redis.incr(GENERATION_KEY);
    log.debug({ domain, generation }, 'Dashboard cache invalidated');
  } catch (error) {
    // A failed invalidation means stale numbers for up to the TTL. That is worth
    // logging loudly, but not worth failing the user's write over — their vehicle
    // was saved.
    log.warn({ err: error, domain }, 'Dashboard cache invalidation failed; entries will expire');
  }
}

// ---------------------------------------------------------------------------
// Invalidation as middleware, not as a call each service must remember
// ---------------------------------------------------------------------------

/** Path prefixes whose writes can change a widget, and the domain they belong to. */
const WATCHED: ReadonlyArray<readonly [RegExp, DashboardDomain]> = [
  [/^\/vehicles/, 'vehicles'],
  [/^\/assignments/, 'vehicles'],
  [/^\/maintenance/, 'maintenance'],
  [/^\/documents/, 'documents'],
  [/^\/damages/, 'damages'],
];

/**
 * Invalidates after any successful write beneath a watched path.
 *
 * **Why middleware rather than a call in each service.** The alternative is
 * `invalidateDashboard()` at the end of roughly twenty write paths, and the
 * failure mode of forgetting one is a dashboard that is quietly wrong for five
 * minutes — no error, no log, and nobody able to reproduce it. Here the rule is
 * stated once and a write endpoint added later is covered without anyone
 * remembering this file exists.
 *
 * It over-invalidates: changing a vehicle's notes retires the cache even though
 * no counter moved. That costs one recomputation, which is the cheap direction
 * of this trade.
 *
 * It fires on `finish` and only for 2xx, so a rejected or failed write leaves
 * the cache alone — and it runs *after* the response, so the Redis round trip is
 * never on the user's critical path.
 */
export function invalidateDashboardOnWrite(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const match = WATCHED.find(([pattern]) => pattern.test(req.path));
    if (!match) {
      next();
      return;
    }

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void invalidateDashboard(match[1]);
      }
    });

    next();
  };
}
