/**
 * Structured logging — FF-104.
 *
 * JSON in every environment except development, where `pino-pretty` makes the
 * stream readable. The redaction list is not decoration: AUTH-03 requires that
 * passwords are never logged in plaintext, and a request logger that prints
 * headers will happily log an `Authorization: Bearer …` or a session cookie
 * unless told otherwise.
 */

import pino, { type Logger } from 'pino';
import { loadEnv } from './env.js';

const env = loadEnv();

/**
 * Paths scrubbed before anything reaches the log stream. Redaction is applied
 * by pino itself, so it also covers objects logged incidentally by middleware.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'currentPassword',
  '*.currentPassword',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'tokenHash',
  '*.tokenHash',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'jwtSecret',
  '*.jwtSecret',
  'serviceRoleKey',
  '*.serviceRoleKey',
  'smtpPassword',
  '*.smtpPassword',
];

export const logger: Logger = pino({
  level: env.logLevel,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'fleetflow-api', env: env.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty output is a development affordance only; production emits JSON so a
  // log shipper can parse it.
  transport:
    env.nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});

/** A child logger tagged with the subsystem it belongs to. */
export function childLogger(component: string): Logger {
  return logger.child({ component });
}
