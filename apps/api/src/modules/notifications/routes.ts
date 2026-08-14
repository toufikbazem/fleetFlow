/**
 * Notification routes — FF-803, FF-805.
 *
 * The centre is `requireAuth` only, with no `authorize()`: notifications are
 * addressed to a person, not to a module, and every query is scoped by the
 * caller's own id. Running the rules is a different matter and is restricted.
 */

import {
  idParamSchema,
  notificationListQuerySchema,
  type NotificationListResponse,
  type NotificationRunResult,
  type UnreadCountResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { params, query, validate } from '../../platform/middleware/validate.js';
import { deliveryHealth, flushQueue } from './delivery.js';
import { listForUser, markAllRead, markRead, runNotifications, unreadCount } from './service.js';

export const notificationsRouter: Router = Router();

notificationsRouter.get(
  '/notifications',
  requireAuth,
  validate({ query: notificationListQuerySchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const response: NotificationListResponse = await listForUser(
      actor.id,
      query(notificationListQuerySchema, req),
    );
    res.json(response);
  },
);

/** Polled by the bell badge, so it stays cheap — one indexed count. */
notificationsRouter.get('/notifications/unread-count', requireAuth, async (req, res) => {
  const actor = authenticated(req);
  const response: UnreadCountResponse = { unreadCount: await unreadCount(actor.id) };
  res.json(response);
});

notificationsRouter.post(
  '/notifications/:id/read',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    res.json({ notification: await markRead(params(idParamSchema, req).id, actor.id) });
  },
);

notificationsRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  const actor = authenticated(req);
  res.json({ marked: await markAllRead(actor.id) });
});

// ---------------------------------------------------------------------------
// Operations — NTF-05
// ---------------------------------------------------------------------------

/**
 * Runs every rule now.
 *
 * The scheduled daily run lives in the worker; this exists so the rules can be
 * exercised during UAT — which is precisely when a non-idempotent engine would
 * email every manager in the company four times. It is safe to call repeatedly
 * by construction: NTF-07's unique index suppresses anything already sent today.
 */
notificationsRouter.post(
  '/notifications/run',
  requireAuth,
  authorize('reports', 'read'),
  async (_req, res) => {
    const result: NotificationRunResult = await runNotifications();
    res.json(result);
  },
);

/** Pushes whatever is still queued. Useful the moment SMTP is first configured. */
notificationsRouter.post(
  '/notifications/flush-email',
  requireAuth,
  authorize('reports', 'read'),
  async (_req, res) => {
    res.json(await flushQueue());
  },
);

/**
 * Delivery health.
 *
 * The PRD's risk register calls silent email failure the way this product fails
 * without anyone noticing. A queue that is quietly growing, or an oldest-queued
 * timestamp from last week, is what that looks like from the outside.
 */
notificationsRouter.get(
  '/notifications/delivery-health',
  requireAuth,
  authorize('reports', 'read'),
  async (_req, res) => {
    res.json(await deliveryHealth());
  },
);
