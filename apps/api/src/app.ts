/**
 * Express application assembly — FF-104.
 *
 * Middleware order is load-bearing and reads top to bottom:
 *
 *   1. security headers        before anything can produce a response
 *   2. CORS                    before a body is parsed, so a rejected origin
 *                              never gets that far
 *   3. request id + logging    so every later line, including a parse failure,
 *                              is attributable
 *   4. body parsing            bounded
 *   5. routes
 *   6. 404, then the error handler — always last
 */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { loadEnv } from './platform/env.js';
import { errorHandler, notFoundHandler } from './platform/middleware/error-handler.js';
import { attachLogger, requestId, requestLogger } from './platform/middleware/request-context.js';
import { assignmentsRouter } from './modules/assignments/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { damagesRouter } from './modules/damages/routes.js';
import { invalidateDashboardOnWrite } from './modules/dashboard/cache.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { documentsRouter } from './modules/documents/routes.js';
import { driversRouter } from './modules/drivers/routes.js';
import { healthRouter } from './modules/health/routes.js';
import { maintenanceRouter } from './modules/maintenance/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { vehiclesRouter } from './modules/vehicles/routes.js';

const env = loadEnv();

/** Versioned so a breaking contract change can be served alongside the old one. */
export const API_PREFIX = '/api/v1';

/** Bounded so an oversized body is rejected before it is buffered. File uploads
 *  never pass through here — they go straight to object storage via a signed
 *  URL (plan §1.5), so 1 MB is generous for JSON. */
const JSON_BODY_LIMIT = '1mb';

export interface CreateAppOptions {
  /**
   * Mounts extra routes after the real ones but before the 404 and error
   * handlers. Used by tests that need a route which throws; there is no
   * production caller.
   */
  configure?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // Behind a reverse proxy, X-Forwarded-* carries the real client address,
  // which rate limiting (AUTH-05) and the audit log both depend on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON, never HTML, so a restrictive CSP costs nothing.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header: same-origin, curl, or a server-to-server call.
        if (!origin) return callback(null, true);
        callback(null, env.corsOrigins.includes(origin));
      },
      // The refresh token is an httpOnly cookie, so the browser must be allowed
      // to send it (AUTH-04).
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
      maxAge: 86_400,
    }),
  );

  app.use(requestId);
  app.use(requestLogger);
  app.use(attachLogger);

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  // Unversioned: /healthz is infrastructure, not part of the product contract.
  app.use(healthRouter);

  // Before the module routers: it only registers a `finish` listener, so it must
  // be in place before a handler can respond.
  app.use(API_PREFIX, invalidateDashboardOnWrite());

  app.use(API_PREFIX, authRouter);
  app.use(API_PREFIX, usersRouter);
  app.use(API_PREFIX, driversRouter);
  app.use(API_PREFIX, vehiclesRouter);
  app.use(API_PREFIX, assignmentsRouter);
  app.use(API_PREFIX, maintenanceRouter);
  app.use(API_PREFIX, documentsRouter);
  app.use(API_PREFIX, damagesRouter);
  app.use(API_PREFIX, notificationsRouter);
  app.use(API_PREFIX, dashboardRouter);
  app.use(API_PREFIX, reportsRouter);

  // Further module routers mount here as each epic lands: dashboard (FF-901)
  // and reports (FF-1001).

  options.configure?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
