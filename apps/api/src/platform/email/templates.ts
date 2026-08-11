/**
 * Email templates — FF-203.
 *
 * Each returns a subject plus the structured content the layout renders into
 * both HTML and plain text. Notification templates (NTF-01…04) join them in
 * FF-804; the shape is the same.
 *
 * English only, per decision Q7 — no translation layer.
 */

import type { EmailContent } from './layout.js';

export interface EmailMessage {
  subject: string;
  content: EmailContent;
}

/**
 * AUTH-02.
 *
 * The wording assumes the recipient may not have asked for this — a reset email
 * arriving unprompted is either a typo by someone else or an attack, and the
 * message should say plainly that ignoring it is safe and changes nothing.
 */
export function passwordResetEmail(params: {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}): EmailMessage {
  return {
    subject: 'Reset your FleetFlow password',
    content: {
      heading: 'Reset your password',
      paragraphs: [
        `Hello ${params.name},`,
        'We received a request to reset the password for your FleetFlow account. Choose a new password using the button below.',
      ],
      action: { label: 'Choose a new password', url: params.resetUrl },
      footnotes: [
        `This link works once and expires in ${params.expiresInMinutes} minutes.`,
        'If you did not request a password reset, you can ignore this email — your password will not change and nobody has gained access to your account.',
      ],
    },
  };
}

/**
 * Sent after a successful reset, to the address that was just changed.
 *
 * This is the message that catches a compromise: if an attacker resets someone
 * else's password, the real owner still gets told, and they get told *after* it
 * happened rather than before.
 */
export function passwordChangedEmail(params: { name: string }): EmailMessage {
  return {
    subject: 'Your FleetFlow password was changed',
    content: {
      heading: 'Your password was changed',
      paragraphs: [
        `Hello ${params.name},`,
        'The password for your FleetFlow account has just been changed. You have been signed out everywhere and will need to sign in again.',
      ],
      footnotes: [
        'If you made this change, no further action is needed.',
        'If you did not, contact your FleetFlow administrator immediately — someone else may have access to your account.',
      ],
    },
  };
}
