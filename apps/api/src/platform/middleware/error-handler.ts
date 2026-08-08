/**
 * Terminal error handling — FF-104.
 *
 * Express 5 forwards rejected promises from async handlers to the error
 * middleware automatically, so handlers can `throw` and nothing needs wrapping.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { NotFoundError, toErrorResponse } from '../errors.js';
import { requestIdOf } from './request-context.js';

/** Unmatched routes become a normal NotFoundError rather than Express's HTML. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

/**
 * The single place a response body is built for a failure.
 *
 * Express identifies an error handler by its arity, so `next` must stay in the
 * signature even though it is unused — hence the underscore.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { status, body, unexpected } = toErrorResponse(error, requestIdOf(req));

  if (unexpected) {
    // The real error only ever goes to the log. The caller receives a generic
    // sentence plus the request id that ties the two together.
    req.log?.error({ err: error }, 'Unhandled error');
  } else if (status >= 500) {
    req.log?.error({ err: error, code: body.error.code }, 'Service error');
  } else {
    req.log?.warn({ code: body.error.code, message: body.error.message }, 'Request rejected');
  }

  if (res.headersSent) {
    // A failure mid-stream cannot be turned into a JSON body; destroying the
    // socket is the only honest signal that the payload is incomplete.
    res.destroy(error instanceof Error ? error : undefined);
    return;
  }

  res.status(status).json(body);
};
