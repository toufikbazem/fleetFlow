/**
 * Authorisation middleware — FF-206.
 *
 * One implementation, driven by the `MATRIX` in @fleetflow/shared, which is the
 * same object the web app reads to decide what to render. Because both consult
 * one table, the UI can never offer an action the API refuses — and, more
 * importantly, never quietly permits one it should not. **The UI mirrors
 * access; it never decides it.**
 *
 * Must run after `requireAuth`. It fails closed if it does not: a route wired
 * without the guard rejects everyone rather than admitting everyone.
 */

import { can, type Action, type Module } from '@fleetflow/shared';
import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors.js';
import type { AccessTokenClaims } from '../../modules/auth/tokens.js';
import type { CallerIdentity, CallerScope } from '../scope.js';

/**
 * Rejects the caller unless the matrix grants `action` on `module`, and
 * publishes the resulting row scope on `req.scope`.
 *
 * The scope is the load-bearing half. A 200 from here means "you may perform
 * this verb on this module" — never "you may perform it on every row".
 */
export function authorize(module: Module, action: Action): RequestHandler {
  return (req, _res, next) => {
    const claims = req.auth;

    if (!claims) {
      // Either the route forgot requireAuth, or the token was rejected earlier.
      // Both are answered the same way, and neither grants access.
      next(new UnauthenticatedError('Authentication is required.'));
      return;
    }

    const decision = can(claims.role, module, action);

    if (!decision.allowed) {
      // 403, never 404. AUTH-06's acceptance criterion says a user calling
      // outside their role receives 403 "regardless of what the UI shows", and
      // an obfuscated status would make that untestable.
      next(new ForbiddenError());
      return;
    }

    const scope: CallerScope = {
      role: claims.role,
      userId: claims.id,
      driverId: claims.driverId,
      scope: decision.scope,
    };

    req.scope = scope;
    next();
  };
}

/**
 * Reads the resolved scope, or throws if the route forgot `authorize`.
 *
 * Repositories take a `CallerScope`, so forgetting the middleware is a loud
 * failure on the first request rather than an unscoped query in production.
 */
export function callerScope(req: { scope?: CallerScope }): CallerScope {
  if (!req.scope) {
    throw new Error('Route is missing the authorize() middleware');
  }
  return req.scope;
}

/**
 * The caller's identity, without a scope.
 *
 * For the polymorphic attachment endpoints, where the governing module depends
 * on the request body and so cannot be decided by middleware. Those services
 * consult the matrix themselves — see `assertCanAttach`. Every other route
 * should use `callerScope` and let `authorize()` do the work.
 */
export function callerIdentity(req: { auth?: AccessTokenClaims }): CallerIdentity {
  if (!req.auth) {
    throw new UnauthenticatedError('Authentication is required.');
  }
  return { role: req.auth.role, userId: req.auth.id, driverId: req.auth.driverId };
}
