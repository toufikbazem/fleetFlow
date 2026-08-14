/**
 * Background worker — FF-803 (NTF-05).
 *
 * A second process from the same build, with a different entrypoint. It owns
 * two loops:
 *
 *   daily    evaluate every notification rule at the configured local time
 *   often    push whatever email is queued
 *
 * **Why this is not BullMQ.** The plan called for it, and BullMQ would be right
 * if jobs needed distribution, priorities or a dashboard. None of that applies
 * here: there is one recurring job a day and a queue whose rows are already a
 * table we are required to keep — `notification_deliveries` is the delivery log
 * NTF acceptance demands, so making it the queue as well means one source of
 * truth rather than two that can disagree about what was sent.
 *
 * It also removes an infrastructure dependency from a deployment that is
 * explicitly out of scope. Redis is still used for sessions and rate limiting;
 * it just is not carrying the queue.
 *
 * **Running two workers is safe.** Both would evaluate the rules, and NTF-07's
 * unique index would let exactly one set of notifications through. That is the
 * same property that makes a manual re-run safe, and it is why it was built
 * into the database rather than into a scheduler.
 */

import { DEFAULT_SETTINGS } from '@fleetflow/shared';
import cron from 'node-cron';
import { disconnectDb, prisma } from '../platform/db.js';
import { envWarnings, loadEnv, loadedEnvFile } from '../platform/env.js';
import { logger } from '../platform/logger.js';
import { closeMailer, mailerMode, verifyMailer } from '../platform/mailer.js';
import { flushQueue } from '../modules/notifications/delivery.js';
import { runNotifications } from '../modules/notifications/service.js';

const log = logger.child({ component: 'worker' });

/** How often queued email is pushed. Retries ride the same sweep. */
const FLUSH_CRON = '*/2 * * * *';

interface Schedule {
  cron: string;
  timezone: string;
  humanTime: string;
}

/**
 * Turns the configured send time into a cron expression.
 *
 * Falls back to the agreed default rather than refusing to start: a worker that
 * will not run because somebody typed "7am" into a settings field is a worse
 * failure than one that runs at 07:00 and logs a complaint.
 */
async function resolveSchedule(): Promise<Schedule> {
  const fallback = DEFAULT_SETTINGS.notifications.dailySendTime;
  const fallbackZone = DEFAULT_SETTINGS.general.timezone;

  let time = fallback;
  let timezone = fallbackZone;

  try {
    const [notifications, general] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'notifications' } }),
      prisma.setting.findUnique({ where: { key: 'general' } }),
    ]);

    const configuredTime = (notifications?.value as { dailySendTime?: string } | null)
      ?.dailySendTime;
    const configuredZone = (general?.value as { timezone?: string } | null)?.timezone;

    if (configuredTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime)) time = configuredTime;
    else if (configuredTime) {
      log.warn({ configuredTime }, `Ignoring an invalid daily send time; using ${fallback}`);
    }

    if (configuredZone) timezone = configuredZone;
  } catch (error) {
    log.error({ err: error }, 'Could not read the schedule from settings; using defaults');
  }

  const [hour, minute] = time.split(':');
  return { cron: `${Number(minute)} ${Number(hour)} * * *`, timezone, humanTime: time };
}

async function runDaily(): Promise<void> {
  const started = Date.now();
  try {
    const result = await runNotifications();
    log.info(
      {
        fireDate: result.fireDate,
        created: result.totalCreated,
        suppressed: result.totalSkipped,
        emailsQueued: result.emailsQueued,
        emailEnabled: result.emailEnabled,
        ms: Date.now() - started,
      },
      'Daily notification run complete',
    );
  } catch (error) {
    // Never rethrown: a failed run must not take the worker down, or one bad
    // day becomes every day until somebody notices the process is gone.
    log.error({ err: error }, 'Daily notification run failed');
  }
}

async function runFlush(): Promise<void> {
  try {
    const result = await flushQueue();
    if (result.attempted > 0) {
      log.info(result, 'Email queue swept');
    }
  } catch (error) {
    log.error({ err: error }, 'Email flush failed');
  }
}

async function start(): Promise<void> {
  const env = loadEnv();
  for (const warning of envWarnings()) log.warn({ scope: 'env' }, warning);

  await verifyMailer();

  const schedule = await resolveSchedule();

  if (!cron.validate(schedule.cron)) {
    throw new Error(`Refusing to start: "${schedule.cron}" is not a valid schedule`);
  }

  const daily = cron.schedule(schedule.cron, () => void runDaily(), {
    timezone: schedule.timezone,
  });

  const flush = cron.schedule(FLUSH_CRON, () => void runFlush());

  log.info(
    {
      environment: env.nodeEnv,
      configFile: loadedEnvFile() ?? 'process environment',
      dailyAt: `${schedule.humanTime} ${schedule.timezone}`,
      emailFlush: 'every 2 minutes',
      email: mailerMode() === 'smtp' ? 'configured' : 'preview (not sending)',
    },
    'FleetFlow worker started',
  );

  // Anything left queued from a previous life goes out now rather than waiting.
  void runFlush();

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'Worker shutting down');
    daily.stop();
    flush.stop();
    await Promise.allSettled([disconnectDb(), closeMailer()]);
    process.exit(0);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
