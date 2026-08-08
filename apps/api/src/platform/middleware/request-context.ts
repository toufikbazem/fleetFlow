/**
 * Request identity and logging — FF-104.
 *
 * Every request carries an id, echoed in the `X-Request-Id` response header and
 * included in any error body. When a user reports "it failed", that id is the
 * whole investigation: it maps a single sentence on screen to the exact log
 * lines the request produced.
 */

import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../logger.js';

/** Accepted from upstream so a proxy or the SPA can propagate its own id. */
const REQUEST_ID_HEADER = 'x-request-id';

/** Bounded and character-restricted: an inbound header is untrusted input. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reads the request id as a string.
 *
 * `req.id` is typed `ReqId` (`string | number`) by pino-http's own Express
 * augmentation. This middleware only ever assigns strings, but the declared
 * type is the union, so call sites go through here rather than casting.
 */
export function requestIdOf(req: { id?: string | number | object }): string {
  return typeof req.id === 'string' ? req.id : String(req.id ?? '');
}

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export const requestLogger: RequestHandler = pinoHttp({
  logger,
  genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
  // 4xx is the caller's mistake and reads as noise at error level; 5xx is ours.
  customLogLevel: (_req, res, err) => {
    if (err) return 'error';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, _res, err) => `${req.method} ${req.url} failed: ${err.message}`,
  // The health check runs on a timer; logging every poll at info buries
  // everything else.
  autoLogging: { ignore: (req) => req.url === '/healthz' },
});

/** Attaches the request-scoped logger created by pino-http. */
export const attachLogger: RequestHandler = (req, _res, next) => {
  req.log = req.log.child({ requestId: req.id });
  next();
};
