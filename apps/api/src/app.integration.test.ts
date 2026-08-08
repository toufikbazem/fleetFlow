/**
 * Express skeleton, end to end — FF-104.
 *
 * The acceptance criteria are behavioural: a thrown async error must come back
 * in the standard envelope with a request id, and /healthz must genuinely reach
 * Postgres and Redis. Both need the real stack, so this is an integration suite.
 *
 * Run with `npm run test:integration` (needs `npm run db:up`).
 */

import { emailSchema } from '@fleetflow/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { disconnectDb } from './platform/db.js';
import { ForbiddenError, NotFoundError, ValidationError } from './platform/errors.js';
import { connectRedis, disconnectRedis } from './platform/redis.js';
import { validate } from './platform/middleware/validate.js';
import { z } from 'zod';

let app: Express;

beforeAll(async () => {
  await connectRedis();

  app = createApp({
    configure: (instance) => {
      // Routes that exist only for this suite. `configure` mounts them before
      // the 404 and error handlers, which is the whole point — an error thrown
      // here travels the same path a real handler's would.
      instance.get('/__test/async-throw', async () => {
        await Promise.resolve();
        throw new Error('deliberate async failure with secret=hunter2');
      });

      instance.get('/__test/sync-throw', () => {
        throw new Error('deliberate sync failure');
      });

      instance.get('/__test/forbidden', () => {
        throw new ForbiddenError();
      });

      instance.get('/__test/not-found', () => {
        throw new NotFoundError('Vehicle');
      });

      instance.get('/__test/validation', () => {
        throw new ValidationError([{ path: 'body.plate', message: 'Plate is required' }]);
      });

      instance.post(
        '/__test/validate',
        validate({
          // The real shared schema, not a local stand-in: it trims and
          // lowercases, so this also proves transformations reach the handler.
          body: z.object({ email: emailSchema, age: z.coerce.number().int().min(18) }),
          query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
        }),
        (req, res) => {
          res.json({ validated: req.validated });
        },
      );
    },
  });
});

afterAll(async () => {
  await Promise.allSettled([disconnectDb(), disconnectRedis()]);
});

describe('/healthz', () => {
  it('reports the database and Redis as reachable', async () => {
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.database.status).toBe('up');
    expect(response.body.checks.redis.status).toBe('up');
    expect(typeof response.body.checks.database.latencyMs).toBe('number');
  });

  it('reports feature configuration without failing on it', async () => {
    const response = await request(app).get('/healthz');
    // Empty in development by design (FF-102), and that must not degrade health.
    expect(['configured', 'unconfigured']).toContain(response.body.features.storage);
    expect(['configured', 'unconfigured']).toContain(response.body.features.email);
    expect(response.status).toBe(200);
  });
});

describe('the error envelope', () => {
  it('catches a thrown async error and returns the standard shape', async () => {
    const response = await request(app).get('/__test/async-throw');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL',
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
    // The thrown message must not reach the caller.
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('catches a synchronous throw the same way', async () => {
    const response = await request(app).get('/__test/sync-throw');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
  });

  it('returns 403 for a forbidden action, not 404', async () => {
    const response = await request(app).get('/__test/forbidden');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 with a code, not Express HTML', async () => {
    const response = await request(app).get('/__test/not-found');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('returns details on a validation failure', async () => {
    const response = await request(app).get('/__test/validation');
    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual([
      { path: 'body.plate', message: 'Plate is required' },
    ]);
  });

  it('turns an unmatched route into the same envelope', async () => {
    const response = await request(app).get('/no/such/route');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('treats malformed JSON as the caller’s mistake, not a server fault', async () => {
    const response = await request(app)
      .post('/__test/validate')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    // A 500 here would read as a server bug and pollute the error log.
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('request ids', () => {
  it('generates one and echoes it in the header', async () => {
    const response = await request(app).get('/healthz');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adopts a caller-supplied id so a trace spans both sides', async () => {
    const response = await request(app)
      .get('/__test/not-found')
      .set('X-Request-Id', 'client-trace-123');

    expect(response.headers['x-request-id']).toBe('client-trace-123');
    expect(response.body.error.requestId).toBe('client-trace-123');
  });

  it('rejects a malformed inbound id rather than reflecting it', async () => {
    // Header injection / log forging: an untrusted id must not be echoed.
    const response = await request(app)
      .get('/healthz')
      .set('X-Request-Id', 'bad id with spaces <script>');

    expect(response.headers['x-request-id']).not.toContain('script');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('validation middleware', () => {
  it('passes parsed, coerced and transformed values through req.validated', async () => {
    const response = await request(app)
      .post('/__test/validate?page=3')
      .send({ email: '  Person@Example.COM  ', age: '30' });

    expect(response.status).toBe(200);
    // Trimmed and lowercased by the shared schema; age coerced from a string.
    expect(response.body.validated.body).toEqual({ email: 'person@example.com', age: 30 });
    // Query strings arrive as text and come back as numbers.
    expect(response.body.validated.query).toEqual({ page: 3 });
  });

  it('applies schema defaults when a value is absent', async () => {
    const response = await request(app).post('/__test/validate').send({ email: 'a@b.co', age: 21 });
    expect(response.body.validated.query).toEqual({ page: 1 });
  });

  it('reports body and query failures together, prefixed by source', async () => {
    const response = await request(app)
      .post('/__test/validate?page=0')
      .send({ email: 'not-an-email', age: 12 });

    expect(response.status).toBe(422);
    const paths = (response.body.error.details as Array<{ path: string }>).map((d) => d.path);
    // All three problems in one response, rather than one round trip each.
    expect(paths).toContain('body.email');
    expect(paths).toContain('body.age');
    expect(paths).toContain('query.page');
  });
});

describe('security headers and CORS', () => {
  it('sets helmet headers and hides the framework', async () => {
    const response = await request(app).get('/healthz');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('allows the configured origin with credentials', async () => {
    const response = await request(app).get('/healthz').set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant access to an unlisted origin', async () => {
    const response = await request(app).get('/healthz').set('Origin', 'https://evil.example');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
