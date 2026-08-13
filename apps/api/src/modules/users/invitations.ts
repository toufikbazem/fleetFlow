/**
 * Invitations — FF-302, USR-04.
 *
 * An invitation is a password reset for an account that never had a password.
 * The mechanism is identical — a single-use, time-limited, hashed token in
 * `password_resets` — so it reuses that table rather than introducing a second
 * one with the same security properties to get wrong twice.
 *
 * Only two things differ, and both are presentation:
 *
 *   the email    "you have been added to FleetFlow" rather than "reset your password"
 *   the link     /accept-invitation rather than /reset-password
 *
 * The link carries the same token and is redeemed by the same endpoint, so the
 * expiry, single-use and session-revocation rules proven in FF-204 apply here
 * without being reimplemented.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { User } from '@fleetflow/shared';
import { prisma } from '../../platform/db.js';
import { loadEnv } from '../../platform/env.js';
import { childLogger } from '../../platform/logger.js';
import { sendEmail } from '../../platform/mailer.js';
import type { EmailMessage } from '../../platform/email/templates.js';

const env = loadEnv();
const log = childLogger('invitations');

const TOKEN_BYTES = 32;

/**
 * Longer than a password reset's 60 minutes.
 *
 * A reset is requested by someone sitting at the screen, so an hour is
 * generous. An invitation is pushed at someone who may be off shift, on leave,
 * or simply not expecting it — an hour would mean most invitations expire
 * before they are read, and every one of those becomes a support request.
 */
export const INVITATION_TTL_HOURS = 72;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invitationUrl(token: string): string {
  const url = new URL('/accept-invitation', env.appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function invitationEmail(params: {
  name: string;
  invitationUrl: string;
  expiresInHours: number;
}): EmailMessage {
  return {
    subject: 'You have been given access to FleetFlow',
    content: {
      heading: 'Set up your FleetFlow account',
      paragraphs: [
        `Hello ${params.name},`,
        'An administrator has created a FleetFlow account for you. Choose a password to finish setting it up.',
      ],
      action: { label: 'Choose your password', url: params.invitationUrl },
      footnotes: [
        `This link works once and expires in ${params.expiresInHours} hours.`,
        'If the link has expired, ask your administrator to send a new invitation.',
      ],
    },
  };
}

/**
 * Issues a fresh invitation token and emails it.
 *
 * Returns whether the email was accepted for delivery. It deliberately does not
 * throw on a mail failure: the account has already been created, and reporting
 * the whole operation as failed would invite an administrator to create the
 * user a second time. The caller surfaces `invitationSent: false` instead, so
 * the UI can offer "resend" rather than implying nothing happened.
 */
export async function sendInvitation(user: User): Promise<boolean> {
  // Any earlier invitation is retired, so only the newest link works.
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  });

  const message = invitationEmail({
    name: user.name,
    invitationUrl: invitationUrl(token),
    expiresInHours: INVITATION_TTL_HOURS,
  });

  try {
    await sendEmail({ to: user.email, subject: message.subject, content: message.content });
    log.info({ userId: user.id }, 'Invitation sent');
    return true;
  } catch (error) {
    log.error({ err: error, userId: user.id }, 'Could not send the invitation email');
    return false;
  }
}
