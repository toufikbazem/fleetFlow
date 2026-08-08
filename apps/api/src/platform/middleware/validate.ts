/**
 * Request validation — FF-104.
 *
 * Schemas come from @fleetflow/shared, so the API validates against exactly the
 * definition the web app used to build the form. A field the client thinks is
 * optional cannot be required here without failing `tsc` on both sides.
 *
 * Parsed output lands on `req.validated`, never back on `req.query` — Express 5
 * exposes `query` through a getter with no setter, and assigning to it throws.
 */

import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError, zodIssuesToFieldIssues } from '../errors.js';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type Source = keyof ValidationSchemas;

const SOURCES: Source[] = ['params', 'query', 'body'];

/**
 * Validates the named parts of a request in one pass.
 *
 * All three sources are checked before failing, so a caller who got both a path
 * parameter and a body field wrong is told about both rather than discovering
 * the second only after fixing the first. Issue paths are prefixed with their
 * source (`body.email`, `query.pageSize`) so the client can route a message to
 * the right control.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: ReturnType<typeof zodIssuesToFieldIssues> = [];
    const validated: Record<string, unknown> = {};

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        issues.push(
          ...zodIssuesToFieldIssues(result.error).map((issue) => ({
            path: issue.path ? `${source}.${issue.path}` : source,
            message: issue.message,
          })),
        );
      }
    }

    if (issues.length > 0) {
      next(new ValidationError(issues));
      return;
    }

    req.validated = validated;
    next();
  };
}

/**
 * Typed accessors. The `validate()` middleware cannot express "this handler now
 * has a body of type X" through Express's types, so handlers read their input
 * back through these — the schema stays the single source of the type.
 */
export function body<T extends ZodTypeAny>(
  _schema: T,
  req: { validated: { body?: unknown } },
): z.infer<T> {
  return req.validated.body as z.infer<T>;
}

export function query<T extends ZodTypeAny>(
  _schema: T,
  req: { validated: { query?: unknown } },
): z.infer<T> {
  return req.validated.query as z.infer<T>;
}

export function params<T extends ZodTypeAny>(
  _schema: T,
  req: { validated: { params?: unknown } },
): z.infer<T> {
  return req.validated.params as z.infer<T>;
}

/** Re-exported so callers can catch a raw parse failure where they need to. */
export { ZodError };
