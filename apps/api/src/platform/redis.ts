/**
 * Redis connection — FF-104.
 *
 * Used later for refresh-token storage and revocation (AUTH-04), rate limiting
 * (AUTH-05), the dashboard aggregate cache (DSH) and the BullMQ queue backing
 * the daily notification job (NTF-05).
 */

import { Redis } from 'ioredis';
import { loadEnv } from './env.js';
import { childLogger } from './logger.js';

const env = loadEnv();
const log = childLogger('redis');

export const redis = new Redis(env.redisUrl, {
  // Bounded backoff. Without a cap, a Redis outage produces an unbounded retry
  // storm in the log; with it, the health check reports the outage and the
  // process keeps serving whatever does not need Redis.
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

redis.on('error', (error: Error) => {
  // Connection errors are expected during an outage and must not crash the
  // process; ioredis emits them on every retry, so this stays at warn.
  log.warn({ err: error }, 'Redis connection error');
});

redis.on('ready', () => {
  log.info('Redis connected');
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') return;
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit().catch(() => redis.disconnect());
}
