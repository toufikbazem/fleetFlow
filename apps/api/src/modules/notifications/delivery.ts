/**
 * Email delivery — FF-804.
 *
 * NTF acceptance: "Email delivery failures are logged and retried; a failure
 * never blocks the in-app notification."
 *
 * The ordering is what enforces the second half. The notification row is
 * committed by the rule engine *before* anything is queued here, so a dead SMTP
 * relay costs the email and nothing else — the bell still lights up, and the
 * information is not lost.
 *
 * Every attempt is written to `notification_deliveries`. The PRD calls
 * deliverability its silent-failure risk, and the only way to answer "did the
 * insurance reminder actually go out?" three weeks later is to have written
 * down the SMTP response at the time.
 */

import { prisma } from '../../platform/db.js';
import { childLogger } from '../../platform/logger.js';
import { mailerMode, sendEmail } from '../../platform/mailer.js';
import { loadRecipientEmails } from './recipients.js';
import type { EmailMessage } from '../../platform/email/templates.js';

const log = childLogger('notification-delivery');

/** Total attempts before a message is abandoned. */
export const MAX_ATTEMPTS = 5;

function notificationEmail(params: {
  name: string;
  title: string;
  body: string;
  linkUrl: string | null;
}): EmailMessage {
  return {
    subject: params.title,
    content: {
      heading: params.title,
      paragraphs: [`Hello ${params.name},`, params.body],
      ...(params.linkUrl ? { action: { label: 'Open in FleetFlow', url: params.linkUrl } } : {}),
      footnotes: [
        'You are receiving this because of your role in FleetFlow. Reminders are sent once per day at most.',
      ],
    },
  };
}

/**
 * Creates the delivery rows a worker will pick up.
 *
 * Queued rather than sent inline: the daily run can produce hundreds of
 * messages at once, and holding the rule engine open while an SMTP relay
 * throttles would leave the run half-finished with no record of where it got to.
 */
export async function queueEmails(notificationIds: string[]): Promise<number> {
  if (notificationIds.length === 0) return 0;

  const result = await prisma.notificationDelivery.createMany({
    data: notificationIds.map((notificationId) => ({
      notificationId,
      channel: 'EMAIL' as const,
      status: 'QUEUED' as const,
    })),
    // A notification already queued must not be queued twice — this is the
    // second line of defence behind NTF-07.
    skipDuplicates: true,
  });

  return result.count;
}

export interface FlushResult {
  attempted: number;
  sent: number;
  failed: number;
  abandoned: number;
  skipped: boolean;
}

/**
 * Sends everything queued, recording the outcome of each attempt.
 *
 * A permanent rejection is not retried: an address the relay refuses outright
 * will be refused four more times, and burning the retry budget on it delays
 * every message behind it.
 */
export async function flushQueue(batchSize = 50): Promise<FlushResult> {
  if (mailerMode() === 'preview') {
    // Unconfigured SMTP. The rows stay QUEUED rather than being marked failed,
    // so they send themselves once credentials arrive (FF-004) instead of
    // needing to be found and replayed by hand.
    log.warn('SMTP is unconfigured — queued notification emails are being held, not discarded');
    return { attempted: 0, sent: 0, failed: 0, abandoned: 0, skipped: true };
  }

  const queued = await prisma.notificationDelivery.findMany({
    where: { status: 'QUEUED', attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, notificationId: true, attempts: true },
  });

  if (queued.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, abandoned: 0, skipped: false };
  }

  const recipients = await loadRecipientEmails(queued.map((row) => row.notificationId));
  const byNotification = new Map(recipients.map((row) => [row.notificationId, row]));

  let sent = 0;
  let failed = 0;
  let abandoned = 0;

  for (const delivery of queued) {
    const recipient = byNotification.get(delivery.notificationId);

    if (!recipient) {
      // The account was deactivated between queueing and sending. Not a
      // failure — there is simply nobody to tell any more.
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          error: 'Recipient is no longer active',
          attempts: MAX_ATTEMPTS,
          lastAttemptAt: new Date(),
        },
      });
      abandoned += 1;
      continue;
    }

    const message = notificationEmail(recipient);
    const attempts = delivery.attempts + 1;

    try {
      const info = await sendEmail({
        to: recipient.email,
        subject: message.subject,
        content: message.content,
      });

      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: info.rejected.length > 0 ? 'FAILED' : 'SENT',
          smtpMessageId: info.messageId || null,
          smtpResponse: info.response ?? null,
          rejected: info.rejected,
          attempts,
          lastAttemptAt: new Date(),
          ...(info.rejected.length > 0 ? { error: 'The server rejected the recipient' } : {}),
        },
      });

      if (info.rejected.length > 0) failed += 1;
      else sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // A 5xx from SMTP is permanent — the address or the content is refused,
      // and repeating it changes nothing.
      const permanent = /\b5\d\d\b/.test(message);
      const exhausted = attempts >= MAX_ATTEMPTS;

      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: permanent || exhausted ? 'FAILED' : 'QUEUED',
          error: message.slice(0, 500),
          attempts: permanent ? MAX_ATTEMPTS : attempts,
          lastAttemptAt: new Date(),
        },
      });

      if (permanent || exhausted) abandoned += 1;
      else failed += 1;

      log.warn(
        { deliveryId: delivery.id, attempts, permanent, err: error },
        'Notification email failed',
      );
    }
  }

  log.info({ attempted: queued.length, sent, failed, abandoned }, 'Email queue flushed');
  return { attempted: queued.length, sent, failed, abandoned, skipped: false };
}

/** Operational view: what is stuck, and why. */
export async function deliveryHealth(): Promise<{
  queued: number;
  sent: number;
  failed: number;
  oldestQueuedAt: string | null;
}> {
  const [queued, sent, failed, oldest] = await Promise.all([
    prisma.notificationDelivery.count({ where: { status: 'QUEUED' } }),
    prisma.notificationDelivery.count({ where: { status: 'SENT' } }),
    prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
    prisma.notificationDelivery.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  return {
    queued,
    sent,
    failed,
    oldestQueuedAt: oldest?.createdAt.toISOString() ?? null,
  };
}
