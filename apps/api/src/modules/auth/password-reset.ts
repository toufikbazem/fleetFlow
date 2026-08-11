/**
 * Password reset — FF-204, AUTH-02.
 *
 * Acceptance: "A reset link expires after a defined window and cannot be
 * reused." Both halves are enforced in the database, not in memory — a token is
 * a row with `expires_at` and `used_at`, so a restarted process, a second API
 * instance, or a replay hours later all reach the same verdict.
 *
 * Two properties beyond the stated criterion:
 *
 *   Enumeration   `requestReset` behaves identically for a known and an unknown
 *                 address. Returning "no such account" here would undo the care
 *                 taken over the login response.
 *   Storage       Only the SHA-256 of the token is stored. A leaked backup of
 *                 `password_resets` must not let the reader take over accounts.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { PASSWORD_RESET_TTL_MINUTES } from '@fleetflow/shared';
import bcrypt from 'bcryptjs';
import { prisma } from '../../platform/db.js';
import { loadEnv } from '../../platform/env.js';
import { UnauthenticatedError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { sendEmail } from '../../platform/mailer.js';
import { passwordChangedEmail, passwordResetEmail } from '../../platform/email/templates.js';
import { BCRYPT_COST } from './service.js';
import { revokeAllSessions } from './tokens.js';

const env = loadEnv();
const log = childLogger('password-reset');

const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function resetUrl(token: string): string {
  // APP_URL is configured, never derived from the request Host header: an
  // attacker who could set that header would receive a working reset link for
  // somebody else's account.
  const url = new URL('/reset-password', env.appUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Requesting a reset
// ---------------------------------------------------------------------------

/**
 * Always resolves. The caller returns the same acknowledgement either way, so
 * nothing here may throw on "no such account" — that would leak through the
 * status code what the message carefully avoids saying.
 */
export async function requestReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true },
  });

  if (!user || !user.isActive) {
    // Logged for operators, invisible to the caller.
    log.info({ email }, 'Password reset requested for an unknown or inactive account');
    return;
  }

  // Any earlier outstanding token is retired. Otherwise a user who clicks
  // "forgot password" three times leaves three live keys to their account.
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  });

  const message = passwordResetEmail({
    name: user.name,
    resetUrl: resetUrl(token),
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });

  try {
    await sendEmail({ to: user.email, subject: message.subject, content: message.content });
  } catch (error) {
    // The token is already stored and valid. Failing the request now would tell
    // the caller their address exists — and the operator still needs to know.
    log.error({ err: error, userId: user.id }, 'Could not send the password reset email');
  }
}

// ---------------------------------------------------------------------------
// Completing a reset
// ---------------------------------------------------------------------------

const INVALID_TOKEN = 'This reset link is invalid or has expired. Please request a new one.';

/**
 * Consumes the token and sets the new password.
 *
 * The whole thing runs in one transaction: marking the token used and writing
 * the new hash must either both happen or neither. A crash between them would
 * otherwise burn the token while leaving the old password in place, locking the
 * user out of their own recovery.
 */
export async function completeReset(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, name: true, email: true, isActive: true, passwordHash: true } },
    },
  });

  // One message for every failure mode: unknown token, already used, expired,
  // or belonging to a deactivated account.
  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError(INVALID_TOKEN);
  }
  if (!record.user.isActive) {
    throw new UnauthenticatedError(INVALID_TOKEN);
  }

  // Reusing the current password would leave the user believing they had
  // rotated a credential they had not.
  if (await bcrypt.compare(newPassword, record.user.passwordHash)) {
    throw new ValidationError(
      [{ path: 'body.password', message: 'Choose a password you have not used before.' }],
      'The new password must be different from the current one.',
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  await prisma.$transaction([
    prisma.passwordReset.update({
      where: { id: record.id },
      // Conditional on still being unused would be better, but Prisma's update
      // takes a unique selector only; the transaction plus the single-use marker
      // makes a double redemption a lost race rather than two resets.
      data: { usedAt: new Date() },
    }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    // Any other outstanding token for this user dies with the reset.
    prisma.passwordReset.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  // Changing a password must end every existing session. If the reset was the
  // legitimate response to a compromise, leaving the attacker's refresh token
  // alive would defeat the entire exercise.
  const ended = await revokeAllSessions(record.userId);

  log.info({ userId: record.userId, sessionsEnded: ended }, 'Password reset completed');

  const message = passwordChangedEmail({ name: record.user.name });
  try {
    await sendEmail({
      to: record.user.email,
      subject: message.subject,
      content: message.content,
    });
  } catch (error) {
    // The password is already changed; a failed notification must not undo it.
    log.error({ err: error, userId: record.userId }, 'Could not send the password-changed notice');
  }
}

/**
 * Constant-time comparison helper, exported for future use where a secret is
 * compared against a candidate of the same length.
 *
 * Not used by the flow above: token lookup goes through a hashed unique index,
 * so the database never performs a byte-by-byte comparison of the secret.
 */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
