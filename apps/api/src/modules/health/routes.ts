/**
 * Liveness and readiness — FF-104.
 *
 * `/healthz` actually talks to Postgres and Redis rather than reporting that
 * the process is running: a health check that only proves the event loop turns
 * is the kind that stays green while every request fails.
 *
 * Feature configuration (Supabase, SMTP) is reported but never fails the check.
 * Those are FF-102's feature tier — unconfigured in development by design, and
 * refused at boot in production, so by the time this runs in production they
 * cannot be missing.
 */

import { Router } from 'express';
import { loadEnv } from '../../platform/env.js';
import { withDeleted } from '../../platform/db.js';
import { redis } from '../../platform/redis.js';

const env = loadEnv();

/** A hung dependency must not hang the health check itself. */
const CHECK_TIMEOUT_MS = 2_000;

type CheckStatus = 'up' | 'down';

interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timed(probe: () => Promise<unknown>): Promise<CheckResult> {
  const started = performance.now();
  try {
    await withTimeout(probe(), CHECK_TIMEOUT_MS);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export const healthRouter: Router = Router();

healthRouter.get('/healthz', async (_req, res) => {
  const [database, cache] = await Promise.all([
    // The unfiltered client: this is a connectivity probe, and routing it
    // through the soft-delete extension would test the extension too.
    timed(() => withDeleted().$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
  ]);

  const healthy = database.status === 'up' && cache.status === 'up';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    environment: env.nodeEnv,
    checks: { database, redis: cache },
    features: {
      storage: env.storage ? 'configured' : 'unconfigured',
      email: env.email ? 'configured' : 'unconfigured',
    },
  });
});
