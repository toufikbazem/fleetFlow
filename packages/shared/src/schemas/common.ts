/**
 * Cross-cutting request and response shapes.
 *
 * Every list endpoint speaks the same pagination dialect and every failure the
 * same error envelope, so the web client needs one implementation of each
 * rather than ten.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

// ---------------------------------------------------------------------------
// Pagination, sorting, search
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** `field:asc` or `field:desc`. Which fields are sortable is per-module. */
export const sortSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_.]*:(asc|desc)$/, 'Expected "field:asc" or "field:desc"');

export const paginationQuerySchema = z.object({
  // `coerce` because query strings arrive as text; the bounds still apply.
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: sortSchema.optional(),
  /** Free-text search; meaning is per-module. */
  q: z.string().trim().min(1).max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface SortOrder {
  field: string;
  direction: 'asc' | 'desc';
}

export function parseSort(sort: string | undefined): SortOrder | undefined {
  if (!sort) return undefined;
  const [field, direction] = sort.split(':');
  if (!field || (direction !== 'asc' && direction !== 'desc')) return undefined;
  return { field, direction };
}

/** Wraps any item schema in the standard list envelope. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Machine-readable failure codes. The client switches on `code`, never on the
 * human-readable `message`.
 *
 * FORBIDDEN is returned for authorisation failures and UNAUTHENTICATED for
 * missing or expired credentials. Neither is disguised as NOT_FOUND: the AUTH-06
 * acceptance criterion says a user calling outside their role receives 403, and
 * a test cannot assert that against a 404.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  /** A feature was called whose configuration is absent — see FF-102's tiered env validation. */
  'SERVICE_UNCONFIGURED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const fieldIssueSchema = z.object({
  /** Dot/bracket path into the submitted body, e.g. `costs.parts`. */
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof fieldIssueSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.array(fieldIssueSchema).optional(),
    /** Correlates a client-side failure with the server log line. */
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNCONFIGURED: 503,
  INTERNAL: 500,
} as const;

// ---------------------------------------------------------------------------
// Optional form fields
// ---------------------------------------------------------------------------

/**
 * Marks a field optional and treats an empty submission as absent.
 *
 * **Why `.optional()` alone is not enough.** `.optional()` admits `undefined`
 * and nothing else. An untouched `<input>` yields `''`, and an untouched
 * `<select>` yields `''` — so a user who fills in only the required fields and
 * submits sends `''` for every field they skipped, and every one of them fails
 * validation. The vehicle form produced seven errors on fields the user had
 * deliberately left blank, each of them nonsense: "Number must be greater than
 * or equal to 1900" on an empty Year, "Invalid uuid" on an unset Type.
 *
 * Coercion makes it worse rather than better: `z.coerce.number()` turns `''`
 * into `0`, so the message complains about a value the user never typed.
 *
 * The fix belongs here rather than in the forms. Both sides validate with these
 * schemas — the client through `zodResolver`, the API on the way in — so fixing
 * it once means the form stops showing phantom errors *and* the endpoint stops
 * rejecting a body that any other client would reasonably send.
 *
 * `null` is treated the same way: it is what a cleared field sends when a form
 * library normalises it.
 */
export function optionalField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    schema.optional(),
  );
}

// ---------------------------------------------------------------------------
// Date ranges — RPT-07, and the dashboard's period filters
// ---------------------------------------------------------------------------

/** Calendar date, `YYYY-MM-DD`. Times are not part of report boundaries. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const dateRangeQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
