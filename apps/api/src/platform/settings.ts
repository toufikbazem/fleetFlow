/**
 * Runtime settings — FF-103, Q4 and Q8.
 *
 * The `settings` table stores one row per branch (`general`, `notifications`,
 * `uploads`), so an administrator can change the notice periods without a
 * redeployment. This reads them back and merges each branch over the agreed
 * defaults.
 *
 * **Nothing here throws.** These values feed the daily reminder job, the
 * dashboard and every cost figure. A missing row, a malformed JSON blob written
 * by hand, or a database blip must degrade to the defaults rather than stopping
 * the reminders — silence is precisely the failure this product exists to
 * prevent, and it is the one failure nobody reports.
 */

import { DEFAULT_SETTINGS, type Settings } from '@fleetflow/shared';
import { prisma } from './db.js';
import { childLogger } from './logger.js';

const log = childLogger('settings');

/**
 * One branch of the settings, merged over its defaults.
 *
 * Shallow merge, deliberately: the branches are flat records of scalars and
 * small arrays, so a stored `{ dailySendTime }` fills in the rest from the
 * defaults, and a stored `documentNoticeDays: [30]` replaces the default array
 * outright rather than being unioned with it — which is what an administrator
 * shortening the list would expect.
 */
export async function loadSettingsBranch<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  try {
    // `key` is widened to string for Prisma: the column is a plain text primary
    // key, and the literal union only constrains which branches exist here.
    const row = await prisma.setting.findUnique({ where: { key: key as string } });
    if (!row) return DEFAULT_SETTINGS[key];
    return { ...DEFAULT_SETTINGS[key], ...(row.value as Partial<Settings[K]>) };
  } catch (error) {
    log.error({ err: error, key }, 'Could not read settings; using defaults');
    return DEFAULT_SETTINGS[key];
  }
}

/** Every branch. One query per branch — three rows, not a reason to optimise. */
export async function loadSettings(): Promise<Settings> {
  const [general, notifications, uploads] = await Promise.all([
    loadSettingsBranch('general'),
    loadSettingsBranch('notifications'),
    loadSettingsBranch('uploads'),
  ]);
  return { general, notifications, uploads };
}
