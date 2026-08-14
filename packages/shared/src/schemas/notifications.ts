/**
 * Notification contract — NTF-01…07.
 *
 * The PRD's core value proposition: replacing manual reminders with automated,
 * rule-based ones tied to date and mileage. Its failure mode is silence, so the
 * shapes below deliberately expose what the job did, not just what it produced.
 */

import { z } from 'zod';
import { DELIVERY_STATUSES, NOTIFICATION_RULES } from '../enums.js';
import { paginated, paginationQuerySchema, uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// In-app notifications
// ---------------------------------------------------------------------------

export const notificationSchema = z.object({
  id: uuidSchema,
  rule: z.enum(NOTIFICATION_RULES),
  entityType: z.string(),
  entityId: uuidSchema,
  /** The calendar day the rule fired. Part of the de-duplication key. */
  fireDate: z.string(),
  title: z.string(),
  body: z.string(),
  /** Where to go to act on it — the whole point of the notification. */
  linkUrl: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = paginated(notificationSchema).extend({
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  rule: z.enum(NOTIFICATION_RULES).optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const unreadCountResponseSchema = z.object({ unreadCount: z.number().int() });
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

// ---------------------------------------------------------------------------
// Delivery log — NTF acceptance, "failures are logged and retried"
// ---------------------------------------------------------------------------

export const notificationDeliverySchema = z.object({
  id: uuidSchema,
  notificationId: uuidSchema,
  channel: z.literal('EMAIL'),
  status: z.enum(DELIVERY_STATUSES),
  smtpMessageId: z.string().nullable(),
  smtpResponse: z.string().nullable(),
  rejected: z.array(z.string()),
  error: z.string().nullable(),
  attempts: z.number().int(),
  lastAttemptAt: z.string().nullable(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

// ---------------------------------------------------------------------------
// Running the rules — NTF-05
// ---------------------------------------------------------------------------

/**
 * What a run actually did.
 *
 * `created` and `skippedDuplicate` are reported separately on purpose: a run
 * that creates nothing because everything was already sent today is healthy,
 * and a run that creates nothing because no rule matched is also healthy — but
 * they mean different things, and an operator staring at "0" needs to know
 * which one they are looking at.
 */
export const notificationRunResultSchema = z.object({
  ranAt: z.string(),
  fireDate: z.string(),
  byRule: z.array(
    z.object({
      rule: z.enum(NOTIFICATION_RULES),
      matched: z.number().int(),
      created: z.number().int(),
      skippedDuplicate: z.number().int(),
    }),
  ),
  totalCreated: z.number().int(),
  totalSkipped: z.number().int(),
  emailsQueued: z.number().int(),
  /** False when SMTP is unconfigured — in-app notifications still happen. */
  emailEnabled: z.boolean(),
});
export type NotificationRunResult = z.infer<typeof notificationRunResultSchema>;
