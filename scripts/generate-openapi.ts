/**
 * OpenAPI 3.1 generator — FF-1301 (PRD §7, "API documentation").
 *
 * The document is *generated* from the Zod schemas that already define the
 * contract, never written by hand. A hand-maintained spec is a second
 * description of the same thing, and the first time somebody adds a field and
 * forgets the document, the two disagree — silently, and in the direction that
 * misleads whoever is integrating against it.
 *
 * Two properties make this trustworthy rather than decorative:
 *
 *   1. **The schemas are the source.** Change a Zod schema and the spec changes
 *      with it, because it is the same object.
 *   2. **Completeness is checked against the live Express router.** An endpoint
 *      that nobody documented fails the build, so the spec cannot quietly fall
 *      behind the API. This is the same technique FF-1207 uses for the
 *      permission matrix, and for the same reason.
 *
 * OpenAPI 3.1 is a superset of JSON Schema 2020-12, so `zod-to-json-schema`
 * output drops in without translation — which is why 3.1 rather than 3.0.
 *
 *   npm run docs:api
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { createApp } from '../apps/api/src/app.js';
import { registeredRoutes, routeKey } from '../apps/api/src/testing/route-inventory.js';
import { OPERATIONS, type Operation } from './openapi/operations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '../docs/openapi.json');

const API_PREFIX = '/api/v1';

/** Routes served outside the versioned prefix. */
const UNPREFIXED = new Set(['GET /healthz']);

// ---------------------------------------------------------------------------
// Schema conversion
// ---------------------------------------------------------------------------

/**
 * Shared component schemas, so a document referenced from six responses is
 * described once. Without this the file is several megabytes of repetition and
 * unreadable in any viewer.
 */
const components: Record<string, unknown> = {};

function toSchema(schema: ZodTypeAny, name: string): Record<string, unknown> {
  const json = zodToJsonSchema(schema, {
    target: 'jsonSchema2020',
    // Definitions are hoisted into `components/schemas`, which is where an
    // OpenAPI viewer looks for them.
    definitionPath: 'components/schemas',
    $refStrategy: 'none',
    name,
  }) as Record<string, unknown>;

  // `zodToJsonSchema` wraps the result under its `name`; unwrap it so the
  // schema sits where OpenAPI expects.
  const definitions = json['components/schemas'] as Record<string, unknown> | undefined;
  const body = definitions?.[name] ?? json;
  return body as Record<string, unknown>;
}

/** Registers a schema as a reusable component and returns a `$ref` to it. */
function component(schema: ZodTypeAny, name: string): Record<string, unknown> {
  components[name] ??= toSchema(schema, name);
  return { $ref: `#/components/schemas/${name}` };
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/**
 * Query schemas become individual parameters rather than one object.
 *
 * A viewer renders each as its own input, which is what makes the spec usable
 * for trying a request rather than only for reading.
 */
function queryParameters(schema: ZodTypeAny, name: string): unknown[] {
  const json = toSchema(schema, name);
  const properties = (json['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((json['required'] ?? []) as string[]);

  return Object.entries(properties).map(([key, value]) => ({
    name: key,
    in: 'query',
    required: required.has(key),
    schema: value,
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
  }));
}

/** `:id` in an Express path becomes `{id}` in OpenAPI, and a required parameter. */
function pathParameters(path: string): unknown[] {
  return [...path.matchAll(/:([a-zA-Z]+)/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
    description: match[1] === 'name' ? 'The report name.' : 'Identifier (UUID) of the resource.',
  }));
}

function openApiPath(route: string): string {
  const path = route.slice(route.indexOf(' ') + 1);
  const prefixed = UNPREFIXED.has(route) ? path : `${API_PREFIX}${path}`;
  return prefixed.replace(/:([a-zA-Z]+)/g, '{$1}');
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<number, string> = {
  200: 'Success.',
  201: 'Created.',
  202: 'Accepted.',
  204: 'Success, with no body.',
  401: 'Not authenticated, or the token has been withdrawn.',
  403: 'Authenticated, but this role may not perform this action.',
  404: 'Not found, or outside the caller’s scope.',
  409: 'Conflicts with the current state.',
  413: 'The body is too large.',
  422: 'The submitted data failed validation. `details` names the fields.',
  429: 'Rate limited.',
  503: 'A required integration is not configured.',
};

/** A stable operationId, e.g. `GET /vehicles/:id` → `getVehiclesById`. */
function operationId(route: string): string {
  const [method = 'get', path = ''] = route.split(' ');
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => (part.startsWith(':') ? `By${capitalise(part.slice(1))}` : capitalise(part)));
  return method.toLowerCase() + parts.join('').replace(/-/g, '');
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function describeAuth(operation: Operation): string {
  if (operation.auth === 'public') return '**Open** — no token required.';
  if (operation.auth === 'any-authenticated') {
    return '**Any signed-in user.** The response is scoped to the caller.';
  }
  return `**Requires \`${operation.auth.module}:${operation.auth.action}\`** in the permission matrix (PRD §2.1). Row-level scoping is applied on top: a Driver sees their own vehicle, a Mechanic their assigned jobs.`;
}

function buildOperation(operation: Operation): Record<string, unknown> {
  const description = [
    operation.description,
    describeAuth(operation),
    operation.prd?.length ? `Serves: ${operation.prd.join(', ')}.` : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  const id = operationId(operation.route);

  const responses: Record<string, unknown> = {};
  for (const [status, schema] of Object.entries(operation.responses)) {
    const code = Number(status);
    responses[status] = {
      description: STATUS_TEXT[code] ?? 'Response.',
      ...(schema
        ? {
            content: {
              'application/json': { schema: component(schema, `${id}Response${status}`) },
            },
          }
        : {}),
    };
  }

  // Every authenticated endpoint can answer these; documenting them once per
  // operation is noise, so they are listed only where they are not obvious.
  if (operation.auth !== 'public') {
    responses['401'] ??= { description: STATUS_TEXT[401] as string, content: errorContent() };
  }
  if (typeof operation.auth === 'object') {
    responses['403'] ??= { description: STATUS_TEXT[403] as string, content: errorContent() };
  }

  return {
    operationId: id,
    tags: [operation.tag],
    summary: operation.summary,
    description,
    ...(operation.auth === 'public' ? { security: [] } : {}),
    parameters: [
      ...pathParameters(operation.route),
      ...(operation.query ? queryParameters(operation.query, `${id}Query`) : []),
    ],
    ...(operation.body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: component(operation.body, `${id}Request`) },
            },
          },
        }
      : {}),
    responses,
  };
}

function errorContent(): Record<string, unknown> {
  return { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } };
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

function assertComplete(): void {
  const live = new Set(registeredRoutes(createApp()).map(routeKey));
  const documented = new Set(OPERATIONS.map((operation) => operation.route));

  const undocumented = [...live].filter((route) => !documented.has(route));
  const stale = [...documented].filter((route) => !live.has(route));

  if (undocumented.length > 0 || stale.length > 0) {
    if (undocumented.length > 0) {
      console.error(`\nUndocumented routes (${undocumented.length}):`);
      for (const route of undocumented) console.error(`  ${route}`);
    }
    if (stale.length > 0) {
      console.error(`\nDocumented but not registered (${stale.length}):`);
      for (const route of stale) console.error(`  ${route}`);
    }
    // A spec that silently omits an endpoint is worse than no spec: it is a
    // document somebody will trust.
    throw new Error('The OpenAPI document does not match the running API.');
  }

  console.warn(`All ${live.size} registered routes are documented.`);
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

function build(): Record<string, unknown> {
  assertComplete();

  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of OPERATIONS) {
    const [method = 'get'] = operation.route.split(' ');
    const path = openApiPath(operation.route);
    paths[path] ??= {};
    (paths[path] as Record<string, unknown>)[method.toLowerCase()] = buildOperation(operation);
  }

  components['Error'] = {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            description: 'Machine-readable. Switch on this, never on the message.',
          },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, message: { type: 'string' } },
            },
          },
          requestId: {
            type: 'string',
            description: 'Correlates this failure with a line in the server log.',
          },
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'FleetFlow API',
      version: '1.0.0',
      description: [
        'The FleetFlow REST API.',
        '',
        '**Generated from the Zod schemas the API validates with**, so this document cannot disagree with what the server accepts. Regenerate with `npm run docs:api`.',
        '',
        '## Authentication',
        '',
        'Sign in at `POST /api/v1/auth/login`. The response carries a short-lived access token; send it as `Authorization: Bearer <token>`. A long-lived refresh token is set as an httpOnly cookie and exchanged at `POST /api/v1/auth/refresh` — it is never readable by script, which is what limits the damage of a compromised page.',
        '',
        '## Authorisation',
        '',
        'Every endpoint is governed by the permission matrix in PRD §2.1. A role that may not perform an action receives **403**, never a disguised 404. Row-level scoping is applied on top of that: a Driver reading vehicles receives the one vehicle they hold, and a record outside their scope answers **404** rather than confirming it exists.',
        '',
        '## Errors',
        '',
        'Every failure uses one envelope. Switch on `error.code`, never on `error.message`. `requestId` appears on every response and correlates a client-side failure with the server log.',
        '',
        '## Pagination',
        '',
        'List endpoints take `page` and `pageSize` (max 100) and return `{ data, page, pageSize, total }`. `total` is the size of the whole filtered set, not of the page.',
      ].join('\n'),
      contact: { name: 'NovaTech Solution' },
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Local development' },
      {
        url: '{origin}',
        description: 'Deployed installation',
        variables: { origin: { default: 'https://fleetflow.example.com' } },
      },
    ],
    tags: [...new Set(OPERATIONS.map((operation) => operation.tag))].map((name) => ({ name })),
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The access token from `POST /api/v1/auth/login`. Expires in 15 minutes.',
        },
      },
    },
  };
}

const document = build();
writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const operationCount = Object.values(document['paths'] as Record<string, object>).reduce(
  (sum, methods) => sum + Object.keys(methods).length,
  0,
);
console.warn(
  `Wrote ${OUTPUT} — ${operationCount} operations, ${Object.keys(components).length} schemas.`,
);
process.exit(0);
