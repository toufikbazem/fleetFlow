/**
 * Transactional email — FF-203.
 *
 * One pooled SMTP transport for the whole process, plus a preview transport for
 * development. Consumers call `sendEmail()` and never touch Nodemailer.
 *
 * **Why pooling matters here.** The daily notification job (FF-803) evaluates
 * every rule at once and can emit hundreds of messages in a minute. Opening a
 * fresh SMTP connection per message is slow and, more importantly, is what most
 * relays throttle on. A bounded pool keeps the burst inside one set of
 * connections and makes the rate limit predictable.
 *
 * **Why a preview transport exists.** SMTP credentials are not yet available
 * (FF-004), and a password-reset flow that returns 503 in development cannot be
 * exercised at all. So outside production an unconfigured mailer logs the
 * rendered message instead of sending it. This is a deliberate, narrow
 * exception to FF-102's "unconfigured features return 503" rule: it applies to
 * email only, where a local stand-in is genuinely useful, and never in
 * production, where env validation already refuses to boot without SMTP.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from './env.js';
import { childLogger } from './logger.js';
import { renderHtml, renderText, type EmailContent } from './email/layout.js';

const env = loadEnv();
const log = childLogger('mailer');

/** Bounded so a burst cannot open an unlimited number of connections. */
const POOL_MAX_CONNECTIONS = 5;
/** Reconnect periodically; long-lived SMTP sessions are often dropped server-side. */
const POOL_MAX_MESSAGES = 100;
/** Ceiling on sustained throughput, to stay under a relay's per-hour allowance. */
const RATE_LIMIT_PER_SECOND = 5;

export type MailerMode = 'smtp' | 'preview';

export interface SendEmailInput {
  to: string;
  subject: string;
  content: EmailContent;
  /** Overrides the configured sender. Rarely needed. */
  from?: string;
}

export interface SendEmailResult {
  mode: MailerMode;
  messageId: string;
  accepted: string[];
  rejected: string[];
  /** The raw SMTP response, kept for the delivery log in FF-804. */
  response?: string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let transporter: Transporter | undefined;
let mode: MailerMode | undefined;

function build(): { transporter: Transporter; mode: MailerMode } {
  if (env.email) {
    return {
      mode: 'smtp',
      transporter: nodemailer.createTransport({
        host: env.email.host,
        port: env.email.port,
        // Implicit TLS on 465; STARTTLS negotiated on 587.
        secure: env.email.secure,
        auth: { user: env.email.user, pass: env.email.password },
        pool: true,
        maxConnections: POOL_MAX_CONNECTIONS,
        maxMessages: POOL_MAX_MESSAGES,
        rateDelta: 1000,
        rateLimit: RATE_LIMIT_PER_SECOND,
      }),
    };
  }

  // Unconfigured outside production: render and log, never send.
  return {
    mode: 'preview',
    transporter: nodemailer.createTransport({ jsonTransport: true }),
  };
}

function getTransporter(): Transporter {
  if (!transporter) {
    const built = build();
    transporter = built.transporter;
    mode = built.mode;
  }
  return transporter;
}

export function mailerMode(): MailerMode {
  if (!mode) getTransporter();
  return mode ?? 'preview';
}

/**
 * Proves the credentials work, at boot rather than at 07:00.
 *
 * Never throws: a relay that is down must not stop the API from serving
 * requests that have nothing to do with email. It logs loudly instead, and the
 * failure surfaces again per-message in the delivery log.
 */
export async function verifyMailer(): Promise<boolean> {
  if (mailerMode() === 'preview') {
    log.warn(
      'Email is UNCONFIGURED — messages will be rendered to the log, not sent. ' +
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM to enable delivery.',
    );
    return false;
  }

  try {
    await getTransporter().verify();
    log.info({ host: env.email?.host, port: env.email?.port }, 'SMTP transport verified');
    return true;
  } catch (error) {
    log.error({ err: error }, 'SMTP verification failed — email will not be delivered');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const from = input.from ?? env.email?.from ?? 'FleetFlow <no-reply@fleetflow.local>';

  const message = {
    from,
    to: input.to,
    subject: input.subject,
    text: renderText(input.content),
    html: renderHtml(input.content),
  };

  const info = (await getTransporter().sendMail(message)) as {
    messageId?: string;
    accepted?: Array<string | { address: string }>;
    rejected?: Array<string | { address: string }>;
    response?: string;
  };

  const normalise = (list: Array<string | { address: string }> | undefined): string[] =>
    (list ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.address));

  const result: SendEmailResult = {
    mode: mailerMode(),
    messageId: info.messageId ?? '',
    accepted: normalise(info.accepted),
    rejected: normalise(info.rejected),
    ...(info.response ? { response: info.response } : {}),
  };

  if (result.mode === 'preview') {
    // The whole message, so a developer can read what would have been sent —
    // including any link the flow depends on.
    log.info(
      { to: input.to, subject: input.subject, body: message.text },
      'EMAIL PREVIEW (not sent — SMTP is unconfigured)',
    );
  } else if (result.rejected.length > 0) {
    log.warn({ to: input.to, rejected: result.rejected }, 'SMTP rejected some recipients');
  } else {
    log.info({ to: input.to, messageId: result.messageId }, 'Email sent');
  }

  return result;
}

export async function closeMailer(): Promise<void> {
  transporter?.close();
  transporter = undefined;
  mode = undefined;
}
