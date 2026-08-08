import { HTTP_STATUS_BY_ERROR_CODE } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ServiceUnconfiguredError } from './env.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  normaliseError,
  toErrorResponse,
  zodIssuesToFieldIssues,
} from './errors.js';

describe('status codes come from the shared table', () => {
  it.each([
    [new ValidationError([]), 422],
    [new UnauthenticatedError(), 401],
    [new ForbiddenError(), 403],
    [new NotFoundError(), 404],
    [new ConflictError(), 409],
  ])('%s', (error, expected) => {
    expect(error.status).toBe(expected);
    expect(HTTP_STATUS_BY_ERROR_CODE[error.code]).toBe(expected);
  });

  it('does not disguise authorisation failures as 404 (AUTH-06)', () => {
    // The acceptance criterion is testable only because 403 stays 403.
    expect(new ForbiddenError().status).toBe(403);
    expect(new ForbiddenError().status).not.toBe(404);
  });
});

describe('unknown errors never leak', () => {
  it('reports a generic message and marks the failure unexpected', () => {
    const secret = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    const wire = toErrorResponse(secret, 'req-1');

    expect(wire.status).toBe(500);
    expect(wire.unexpected).toBe(true);
    expect(wire.body.error.code).toBe('INTERNAL');
    expect(wire.body.error.message).not.toContain('hunter2');
    expect(wire.body.error.message).not.toContain('10.0.0.5');
    expect(wire.body.error.requestId).toBe('req-1');
  });

  it('treats a Prisma validation error as our bug, not the caller’s', () => {
    const error = new Prisma.PrismaClientValidationError('Invalid `prisma.user.findMany()`', {
      clientVersion: '6.0.0',
    });
    expect(normaliseError(error)).toBeUndefined();
    expect(toErrorResponse(error).body.error.code).toBe('INTERNAL');
  });

  it('does not echo a string that was thrown', () => {
    expect(toErrorResponse('database credentials rejected').body.error.message).not.toContain(
      'credentials',
    );
  });
});

describe('known errors are described to the caller', () => {
  it('keeps the message and details of an AppError', () => {
    const error = new ValidationError([{ path: 'body.email', message: 'Invalid email' }]);
    const wire = toErrorResponse(error, 'req-2');

    expect(wire.unexpected).toBe(false);
    expect(wire.body.error.code).toBe('VALIDATION_FAILED');
    expect(wire.body.error.details).toEqual([{ path: 'body.email', message: 'Invalid email' }]);
  });

  it('omits an empty details array rather than sending []', () => {
    expect(toErrorResponse(new ValidationError([])).body.error.details).toBeUndefined();
  });

  it('omits requestId when there is none', () => {
    expect(toErrorResponse(new NotFoundError()).body.error.requestId).toBeUndefined();
  });
});

describe('Zod errors become field issues', () => {
  const schema = z.object({
    email: z.string().email(),
    costs: z.object({ parts: z.number() }),
    tags: z.array(z.string()),
  });

  it('maps nested and indexed paths', () => {
    const result = schema.safeParse({ email: 'nope', costs: { parts: 'x' }, tags: [1] });
    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = zodIssuesToFieldIssues(result.error).map((i) => i.path);
    expect(paths).toContain('email');
    expect(paths).toContain('costs.parts');
    expect(paths).toContain('tags[0]');
  });

  it('is normalised to a 422 without being wrapped by hand', () => {
    const result = schema.safeParse({});
    if (result.success) throw new Error('expected a parse failure');
    expect(toErrorResponse(result.error).status).toBe(422);
  });
});

describe('Prisma errors that are the caller’s mistake', () => {
  function prismaError(code: string, meta?: Record<string, unknown>) {
    return new Prisma.PrismaClientKnownRequestError('boom', {
      code,
      clientVersion: '6.0.0',
      ...(meta ? { meta } : {}),
    });
  }

  it('P2002 unique violation becomes 409 and names the field, not the value', () => {
    const wire = toErrorResponse(prismaError('P2002', { target: ['plate'] }));
    expect(wire.status).toBe(409);
    expect(wire.body.error.code).toBe('CONFLICT');
    expect(wire.body.error.message).toContain('plate');
  });

  it('P2025 missing record becomes 404', () => {
    expect(toErrorResponse(prismaError('P2025')).status).toBe(404);
  });

  it('P2003 foreign key violation becomes 409', () => {
    expect(toErrorResponse(prismaError('P2003')).status).toBe(409);
  });

  it('an unmapped Prisma code stays internal rather than guessing', () => {
    const wire = toErrorResponse(prismaError('P9999'));
    expect(wire.status).toBe(500);
    expect(wire.body.error.message).not.toContain('boom');
  });
});

describe('body-parser failures are the caller’s mistake', () => {
  /** Shaped like the http-errors instance express.json() throws. */
  function bodyParserError(type: string): Error {
    return Object.assign(new SyntaxError('Unexpected end of JSON input'), {
      type,
      status: 400,
      expose: true,
    });
  }

  it('malformed JSON becomes 422, not 500', () => {
    const wire = toErrorResponse(bodyParserError('entity.parse.failed'));
    expect(wire.status).toBe(422);
    expect(wire.unexpected).toBe(false);
  });

  it('an oversized body becomes 413', () => {
    expect(toErrorResponse(bodyParserError('entity.too.large')).status).toBe(413);
  });

  it('an unsupported charset becomes 415', () => {
    expect(toErrorResponse(bodyParserError('charset.unsupported')).status).toBe(415);
  });

  it('an internal error that merely has a `type` is not mistaken for one', () => {
    // expose !== true, so this must stay INTERNAL rather than being described.
    const internal = Object.assign(new Error('pg pool exhausted'), { type: 'pool.error' });
    expect(toErrorResponse(internal).status).toBe(500);
  });
});

describe('an unconfigured feature surfaces as 503', () => {
  it('maps ServiceUnconfiguredError and names the variables to set', () => {
    const wire = toErrorResponse(new ServiceUnconfiguredError('email'));
    expect(wire.status).toBe(503);
    expect(wire.body.error.code).toBe('SERVICE_UNCONFIGURED');
    expect(wire.body.error.message).toContain('SMTP_HOST');
    expect(wire.unexpected).toBe(false);
  });
});

describe('AppError basics', () => {
  it('preserves the cause chain for logging', () => {
    const cause = new Error('root cause');
    const error = new AppError('CONFLICT', 'wrapped', { cause });
    expect(error.cause).toBe(cause);
  });

  it('names itself after its subclass', () => {
    expect(new ForbiddenError().name).toBe('ForbiddenError');
  });
});
