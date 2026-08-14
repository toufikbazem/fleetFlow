/**
 * Notification centre and run orchestration — FF-801, FF-805.
 */

import type {
  Notification,
  NotificationListQuery,
  NotificationRunResult,
  Paginated,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { NotFoundError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { mailerMode } from '../../platform/mailer.js';
import { flushQueue, queueEmails } from './delivery.js';
import { evaluateRules, type RunOptions } from './rules.js';

const log = childLogger('notifications');

const NOTIFICATION_SELECT = {
  id: true,
  rule: true,
  entityType: true,
  entityId: true,
  fireDate: true,
  title: true,
  body: true,
  linkUrl: true,
  readAt: true,
  createdAt: true,
} as const;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    rule: row.rule,
    entityType: row.entityType,
    entityId: row.entityId,
    fireDate: row.fireDate.toISOString().split('T')[0] ?? '',
    title: row.title,
    body: row.body,
    linkUrl: row.linkUrl,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The centre — FF-805
// ---------------------------------------------------------------------------

/**
 * Always scoped to the caller.
 *
 * There is no "all notifications" view, for anyone. A notification is addressed
 * to one person; an administrator reading everyone else's would be reading
 * their colleagues' work queues, which is neither useful nor theirs.
 */
export async function listForUser(
  userId: string,
  query: NotificationListQuery,
): Promise<Paginated<Notification> & { unreadCount: number }> {
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
    ...(query.rule ? { rule: query.rule } : {}),
  };

  const [rows, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    data: rows.map(toNotification),
    page: query.page,
    pageSize: query.pageSize,
    total,
    unreadCount,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(id: string, userId: string): Promise<Notification> {
  // Scoped by userId in the `where`, so marking somebody else's notification
  // read is a 404 rather than a silent success.
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Notification');

  const row = await prisma.notification.update({
    where: { id },
    // Idempotent: re-reading something already read must not move the
    // timestamp, or "when did I first see this" becomes unanswerable.
    data: { readAt: new Date() },
    select: NOTIFICATION_SELECT,
  });

  return toNotification(row);
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// The run — NTF-05
// ---------------------------------------------------------------------------

/**
 * Evaluates every rule, then queues email for whatever was newly created.
 *
 * Order matters and is the acceptance criterion: notifications are committed
 * first, email second. A failure in the second step leaves the first intact.
 */
export async function runNotifications(options: RunOptions = {}): Promise<NotificationRunResult> {
  const { result, createdIds } = await evaluateRules(options);

  // Only the rows created by this run: anything suppressed as a duplicate was
  // already queued by whichever run created it.
  const emailsQueued = await queueEmails(createdIds);

  // Sent opportunistically here so a manual re-run delivers immediately rather
  // than waiting for the worker's next sweep. Safe either way — the queue is
  // the single source of truth about what still needs sending.
  if (emailsQueued > 0) {
    void flushQueue().catch((error: unknown) => {
      log.error({ err: error }, 'Could not flush the email queue after a run');
    });
  }

  return {
    ...result,
    emailsQueued,
    emailEnabled: mailerMode() === 'smtp',
  };
}
