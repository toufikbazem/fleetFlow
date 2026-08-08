/**
 * Authentication middleware — FF-201, extended by FF-202.
 *
 * Establishes *who* the caller is. Deciding what they may do is FF-206's
 * `authorize()`, which builds on `req.auth` set here. The two are separate on
 * purpose: 401 means "I don't know who you are", 403 means "I know, and no".
 */

import type { RequestHandler } from 'express';
import { UnauthenticatedError } from '../errors.js';
import {
  isAccessTokenDenied,
  isAccessTokenStale,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../../modules/auth/tokens.js';

const BEARER = /^Bearer (.+)$/;

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = BEARER.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * Rejects the request unless it carries a valid, unexpired, unrevoked token.
 *
 * The denylist check costs one Redis round trip per authenticated request.
 * That is the price of AUTH-04 being true rather than cosmetic: a signature
 * proves the token was issued, and only external state can prove it has not
 * since been withdrawn. The lookup is a single `EXISTS` against a set that
 * cannot hold more than one access-token lifetime of entries.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.get('authorization'));

  if (!token) {
    next(new UnauthenticatedError('Authentication is required.'));
    return;
  }

  void (async () => {
    try {
      const claims = verifyAccessToken(token);

      if (await isAccessTokenDenied(claims.jti)) {
        throw new UnauthenticatedError('This session has been ended. Please sign in again.');
      }

      // USR-02: a role change must apply on the next request. The message is
      // distinct so the client refreshes rather than sending the user to the
      // login screen — their refresh token is still good, and the token it
      // mints will carry the new role.
      if (await isAccessTokenStale(claims)) {
        throw new UnauthenticatedError('Your permissions changed. Refreshing your session.');
      }

      req.auth = claims;
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/**
 * Populates `req.auth` when a usable token is present, and stays silent when it
 * is not.
 *
 * Only for endpoints that must work either way — logout is the case that
 * matters: a user whose access token has already expired still needs their
 * refresh token revoked, and refusing the request would strand a live session
 * that nobody can now end.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.get('authorization'));
  if (!token) {
    next();
    return;
  }

  void (async () => {
    try {
      const claims = verifyAccessToken(token);
      if (!(await isAccessTokenDenied(claims.jti))) {
        req.auth = claims;
      }
    } catch {
      // An invalid or expired token is simply absent as far as this route is
      // concerned. Never fatal — that is the point of the middleware.
    }
    next();
  })();
};

/**
 * Reads the authenticated caller, or throws if the route forgot `requireAuth`.
 *
 * Handlers use this rather than `req.auth!` so a missing guard fails loudly at
 * the first request instead of dereferencing undefined somewhere deeper.
 */
export function authenticated(req: { auth?: AccessTokenClaims }): AccessTokenClaims {
  if (!req.auth) {
    throw new Error('Route is missing the requireAuth middleware');
  }
  return req.auth;
}
