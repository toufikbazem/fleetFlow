/**
 * Runtime-configurable settings and their defaults.
 *
 * These live in the `settings` table (FF-103) and are editable by an
 * administrator, not baked into the build. That is deliberate: the notice
 * periods and daily send time are the numbers most likely to be tuned after
 * go-live, and tuning them must never require a redeployment.
 *
 * The values below are the client's agreed defaults (decisions Q4 and Q8) and
 * seed the table on first migration.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** `HH:mm`, 24-hour, in the timezone named by `general.timezone`. */
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24-hour time such as "07:00"');

/**
 * Descending notice thresholds in days. Descending order matters: the rule
 * engine walks them to decide which threshold a record has just crossed.
 */
const noticeDaysSchema = z
  .array(z.number().int().positive())
  .min(1)
  .refine(
    (days) => days.every((d, i) => i === 0 || d < (days[i - 1] ?? Infinity)),
    'Notice periods must be strictly descending, e.g. [30, 15, 7]',
  );

export const settingsSchema = z.object({
  general: z.object({
    /** IANA zone. Everything date-sensitive — due dates, the daily job, report boundaries — resolves against this. */
    timezone: z.string().min(1),
    currency: z.string().length(3).toUpperCase(),
    locale: z.string().min(2),
  }),
  notifications: z.object({
    documentNoticeDays: noticeDaysSchema,
    maintenanceNoticeDays: noticeDaysSchema,
    /** Mileage remaining before a mileage-triggered task is announced. */
    maintenanceNoticeKm: z.number().int().positive(),
    dailySendTime: timeOfDaySchema,
  }),
  uploads: z.object({
    maxFileSizeBytes: z.number().int().positive(),
    allowedMimeTypes: z.array(z.string().min(1)).min(1),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Partial update — an administrator may PATCH one branch at a time. */
export const settingsUpdateSchema = settingsSchema.deepPartial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Q12 — scans, invoices and damage photos. HEIC included: it is what iPhones produce. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export const DEFAULT_SETTINGS: Settings = {
  general: {
    // TODO(FF-003): the client agreed the send time but not the zone it is
    // read in. UTC until confirmed — worth settling before go-live, because a
    // 07:00 job in the wrong zone announces expiries on the wrong calendar day.
    timezone: 'UTC',
    currency: 'USD',
    locale: 'en-US',
  },
  notifications: {
    documentNoticeDays: [30, 15, 7],
    maintenanceNoticeDays: [14, 7, 1],
    maintenanceNoticeKm: 500,
    dailySendTime: '07:00',
  },
  uploads: {
    maxFileSizeBytes: MAX_UPLOAD_BYTES,
    allowedMimeTypes: [...ALLOWED_UPLOAD_MIME_TYPES],
  },
};
