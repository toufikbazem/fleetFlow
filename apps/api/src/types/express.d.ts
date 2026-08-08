/**
 * Express request augmentations.
 *
 * `validated` rather than reassigning `req.query`: in Express 5 `req.query` is a
 * getter with no setter, so the common Express 4 habit of overwriting it with
 * the parsed result throws at runtime. Parsed input therefore lives in its own
 * namespace, which also keeps "raw input" and "validated input" visibly distinct
 * at every call site.
 */

import type { Logger } from 'pino';
import type { AccessTokenClaims } from '../modules/auth/tokens.js';
import type { CallerScope } from '../platform/scope.js';

declare global {
  namespace Express {
    interface Request {
      // `id` is intentionally NOT declared here: pino-http already augments it
      // as `ReqId` (string | number), and a second declaration of the same
      // property conflicts. Use `requestIdOf(req)` to read it as a string.

      /** Request-scoped logger, pre-tagged with the request id. */
      log: Logger;

      /**
       * The verified caller, set by `requireAuth`. Absent on public routes —
       * read it through `authenticated(req)` so a route that forgot the guard
       * fails loudly rather than silently treating everyone as anonymous.
       */
      auth?: AccessTokenClaims;

      /**
       * The row scope granted by `authorize()`. Repositories require it, so a
       * query cannot be built without having decided how far it reaches.
       */
      scope?: CallerScope;
      /** Output of the `validate()` middleware. Populated only for what it checked. */
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
