/**
 * Error taxonomy and the wire format — FF-104.
 *
 * Every failure leaves the API in one shape:
 *
 *   { "error": { "code", "message", "details"?, "requestId"? } }
 *
 * `code` is machine-readable and comes from @fleetflow/shared, so the web client
 * switches on it rather than on prose. The HTTP status is derived from the code
 * through one table — a handler cannot return 403 with a NOT_FOUND body, or
 * invent a status that the client has no branch for.
 *
 * Note what is deliberately absent: authorisation failures return 403 and
 * authentication failures 401. Neither is disguised as a 404. AUTH-06's
 * acceptance criterion says a user calling outside their role receives 403, and
 * a test cannot assert that against an obfuscated status.
 */

import {
  HTTP_STATUS_BY_ERROR_CODE,
  type ErrorCode,
  type ErrorResponse,
  type FieldIssue,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ServiceUnconfiguredError } from './env.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export interface AppErrorOptions {
  details?: FieldIssue[];
  cause?: unknown;
}

/**
 * A failure the API intends to describe to the caller. Anything that is *not*
 * an AppError is treated as a bug and reported as INTERNAL with a generic
 * message — see `toErrorResponse`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: FieldIssue[] | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = HTTP_STATUS_BY_ERROR_CODE[code];
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(details: FieldIssue[], message = 'The submitted data is invalid.') {
    super('VALIDATION_FAILED', message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', `${resource} was not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state.') {
    super('CONFLICT', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Try again shortly.') {
    super('RATE_LIMITED', message);
  }
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/** Zod issue paths become dot/bracket strings the client can map to a field. */
export function zodIssuesToFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path
      .map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment))
      .join('.')
      .replace(/\.\[/g, '['),
    message: issue.message,
  }));
}

/**
 * Known Prisma failures that correspond to a caller mistake rather than a bug.
 * Anything else falls through to INTERNAL — a Prisma error message can contain
 * table and column names, so it is never forwarded verbatim.
 */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): AppError | undefined {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint. The constraint name is safe to hint at, but the
      // offending value is not echoed back.
      const target = error.meta?.['target'];
      const fields = Array.isArray(target) ? target.join(', ') : undefined;
      return new ConflictError(
        fields
          ? `A record with that ${fields} already exists.`
          : 'A record with those details already exists.',
      );
    }
    case 'P2025':
      return new NotFoundError('Record');
    case 'P2003':
      return new ConflictError('A related record is missing or still referenced.');
    case 'P2000':
      return new ValidationError([], 'A submitted value is too long for its field.');
    default:
      return undefined;
  }
}

/**
 * Body-parser failures.
 *
 * `express.json()` throws an http-errors instance when the body is malformed or
 * oversized. Left unmapped these fall through to INTERNAL, so a client sending
 * broken JSON would see a 500 — which reads as a server bug, pollutes the error
 * log, and tells the caller nothing about what they did wrong.
 */
interface HttpErrorLike {
  type?: string;
  status?: number;
  expose?: boolean;
}

function fromBodyParser(error: unknown): AppError | undefined {
  if (!(error instanceof Error)) return undefined;
  const candidate = error as unknown as HttpErrorLike;
  if (typeof candidate.type !== 'string' || candidate.expose !== true) return undefined;

  switch (candidate.type) {
    case 'entity.parse.failed':
      return new ValidationError([], 'The request body is not valid JSON.');
    case 'entity.too.large':
      return new AppError('PAYLOAD_TOO_LARGE', 'The request body is too large.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError('UNSUPPORTED_MEDIA_TYPE', 'The request encoding is not supported.');
    default:
      return undefined;
  }
}

/** Normalises anything thrown into an AppError, or undefined if it is a bug. */
export function normaliseError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new ValidationError(zodIssuesToFieldIssues(error));
  }

  if (error instanceof ServiceUnconfiguredError) {
    return new AppError('SERVICE_UNCONFIGURED', error.message, { cause: error });
  }

  const bodyParserError = fromBodyParser(error);
  if (bodyParserError) return bodyParserError;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return fromPrisma(error);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // A malformed query is our bug, not the caller's — do not expose the text.
    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

const INTERNAL_MESSAGE = 'An unexpected error occurred. The incident has been logged.';

export interface WireError {
  status: number;
  body: ErrorResponse;
  /** True when the cause is a bug and should be logged at error level. */
  unexpected: boolean;
}

/**
 * Builds the response body. An unrecognised error never leaks its message: the
 * caller gets a generic sentence plus the request id, and the real detail goes
 * to the log where it belongs.
 */
export function toErrorResponse(error: unknown, requestId?: string): WireError {
  const normalised = normaliseError(error);

  if (!normalised) {
    return {
      status: HTTP_STATUS_BY_ERROR_CODE.INTERNAL,
      body: {
        error: {
          code: 'INTERNAL',
          message: INTERNAL_MESSAGE,
          ...(requestId ? { requestId } : {}),
        },
      },
      unexpected: true,
    };
  }

  return {
    status: normalised.status,
    body: {
      error: {
        code: normalised.code,
        message: normalised.message,
        ...(normalised.details && normalised.details.length > 0
          ? { details: normalised.details }
          : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
    unexpected: false,
  };
}
