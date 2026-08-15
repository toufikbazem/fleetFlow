/**
 * Clears the login rate limiter — FF-1202.
 *
 * Run automatically by `pretest:e2e`.
 *
 * AUTH-05 counts login attempts per IP, and every spec in this suite signs in —
 * thirty-odd sign-ins from one address per run. Two or three runs in quick
 * succession trip the limit, and every test then fails at `waitForURL` with a
 * timeout that looks like a broken application rather than an exhausted
 * counter. That is a bad half-hour for whoever is on the other end of it.
 *
 * Only the rate-limit keys are removed. Flushing the whole database would also
 * drop live sessions and the dashboard cache, and a suite that quietly resets
 * application state is a suite whose passes mean less.
 *
 * A separate script rather than a Playwright `globalSetup`: Playwright's ESM
 * loader refuses to load a TypeScript setup module that imports ioredis, and an
 * npm pre-script does the same job without fighting the loader.
 */

import { Redis } from 'ioredis';

/** The exact prefixes `platform/rate-limit.ts` writes. */
const RATE_LIMIT_PATTERNS = ['ratelimit:*', 'authfail:*', 'lockout:*'];

async function clearRateLimits(): Promise<void> {
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });

  try {
    await redis.connect();
    let removed = 0;

    for (const pattern of RATE_LIMIT_PATTERNS) {
      // SCAN rather than KEYS: KEYS blocks the server for the whole sweep, and
      // this runs against whatever Redis the developer has to hand.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== '0');
    }

    // `warn` rather than `log`: this is a script, and the lint rule that bans
    // stray `console.log` in application code applies here too.
    if (removed > 0) console.warn(`[e2e] cleared ${removed} rate-limit keys`);
  } catch (error) {
    // Not fatal: a missing Redis is a problem the first test will report far
    // more clearly than a setup hook can.
    console.warn(`[e2e] could not clear rate limits: ${(error as Error).message}`);
  } finally {
    redis.disconnect();
  }
}

await clearRateLimits();
