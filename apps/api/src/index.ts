/**
 * FleetFlow API entrypoint — FF-104.
 *
 * Order matters: the environment is validated before any client is constructed,
 * and the dependencies are reached before the listener opens, so the process
 * either serves traffic properly or fails visibly at startup rather than
 * accepting requests it cannot fulfil.
 */

import type { Server } from 'node:http';
import { createApp } from './app.js';
import { disconnectDb } from './platform/db.js';
import { envWarnings, loadEnv, loadedEnvFile } from './platform/env.js';
import { logger } from './platform/logger.js';
import { closeMailer, mailerMode, verifyMailer } from './platform/mailer.js';
import { connectRedis, disconnectRedis } from './platform/redis.js';

/** How long an in-flight request has to finish before the process exits. */
const SHUTDOWN_GRACE_MS = 10_000;

async function start(): Promise<void> {
  const env = loadEnv();

  for (const warning of envWarnings()) {
    logger.warn({ scope: 'env' }, warning);
  }

  await connectRedis();

  // Proves the SMTP credentials now rather than at 07:00 when the notification
  // job first needs them. Never fatal: a relay outage must not stop the API
  // serving the requests that have nothing to do with email.
  await verifyMailer();

  const app = createApp();

  const server: Server = app.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        environment: env.nodeEnv,
        configFile: loadedEnvFile() ?? 'process environment',
        storage: env.storage ? 'configured' : 'unconfigured',
        email: mailerMode() === 'smtp' ? 'configured' : 'preview (not sending)',
      },
      `FleetFlow API listening on port ${env.port}`,
    );
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    // A second Ctrl-C should not start a second teardown.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled([disconnectDb(), disconnectRedis(), closeMailer()]);

    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(0);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  // A rejection that reaches here is a bug: the state of the process is no
  // longer known, so it is logged and the process ends rather than continuing
  // to serve from an uncertain state.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
}

start().catch((error: unknown) => {
  // The logger may not exist yet if env validation failed, so this goes to
  // stderr directly and keeps the readable report from loadEnv().
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
