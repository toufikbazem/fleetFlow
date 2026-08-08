/**
 * Auth routes — FF-201.
 *
 * POST /auth/login   AUTH-01
 * GET  /auth/me
 *
 * /auth/refresh and /auth/logout arrive with FF-202; password reset with
 * FF-204. The refresh cookie is already issued here so that FF-202 has
 * something to rotate.
 */

import {
  FORGOT_PASSWORD_ACK,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  type LoginResponse,
  type MeResponse,
  type RefreshResponse,
} from '@fleetflow/shared';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { loadEnv } from '../../platform/env.js';
import { UnauthenticatedError } from '../../platform/errors.js';
import {
  authenticated,
  optionalAuth,
  requireAuth,
} from '../../platform/middleware/require-auth.js';
import { body, validate } from '../../platform/middleware/validate.js';
import { rateLimit } from '../../platform/rate-limit.js';
import { completeReset, requestReset } from './password-reset.js';
import { currentUser, login, logout, refreshSession } from './service.js';
import { refreshTokenTtlSeconds } from './tokens.js';

const env = loadEnv();

/** Read by FF-202's refresh and logout handlers. */
export const REFRESH_COOKIE_NAME = 'fleetflow_refresh';

/**
 * The refresh cookie never reaches JavaScript and is never sent on an ordinary
 * request:
 *
 *   httpOnly  an XSS payload can read the access token from memory, but not
 *             this — so a script injection cannot mint a long-lived session.
 *   sameSite  'lax' blocks the cookie on cross-site POSTs, which is what makes
 *             CSRF against the refresh endpoint impractical.
 *   secure    outside development, refuse to travel over plain HTTP. Left off
 *             in development because localhost is not HTTPS and the browser
 *             would silently discard the cookie.
 *   path      scoped to the auth routes, so it is not attached to every API
 *             call and cannot leak through an unrelated handler.
 */
export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: refreshTokenTtlSeconds() * 1000,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  // maxAge is omitted deliberately: the attributes must otherwise match the
  // cookie that was set, or the browser keeps the original.
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

export const authRouter: Router = Router();

/**
 * Per-IP limits on the unauthenticated endpoints — AUTH-05.
 *
 * These sit alongside the per-account lockout in the login service, and the two
 * catch different attacks: a limit here stops one machine trying thousands of
 * accounts, while the lockout stops thousands of machines trying one account.
 *
 * **The per-IP numbers are deliberately loose.** A fleet operator's staff sit
 * behind one office NAT, so every login the company makes shares a single
 * bucket. A limit tight enough to slow a determined attacker would lock out the
 * whole customer at the start of a shift — and the attacker would simply rotate
 * addresses. Precision comes from the per-account lockout, which follows the
 * account rather than the address; this is the blunt instrument that stops a
 * single host hammering the endpoint.
 */
const loginRateLimit = rateLimit({ name: 'login', limit: 100, windowSeconds: 15 * 60 });

/**
 * Tighter, because each request sends an email. Without a limit the endpoint is
 * a free mail cannon pointed at any address an attacker chooses, and the sending
 * domain's reputation is what pays for it. Still comfortably above what a shared
 * office address would produce — a reset is a rare event per person.
 */
const forgotPasswordRateLimit = rateLimit({
  name: 'forgot-password',
  limit: 20,
  windowSeconds: 15 * 60,
});

/** Blunts brute-forcing a reset token, which is otherwise guarded only by its entropy. */
const resetPasswordRateLimit = rateLimit({
  name: 'reset-password',
  limit: 30,
  windowSeconds: 15 * 60,
});

authRouter.post(
  '/auth/login',
  loginRateLimit,
  validate({ body: loginRequestSchema }),
  async (req, res) => {
    const credentials = body(loginRequestSchema, req);

    const result = await login(credentials, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    setRefreshCookie(res, result.refreshToken);

    // The refresh token is never in the body — only in the httpOnly cookie.
    const response: LoginResponse = result.response;
    res.json(response);
  },
);

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

authRouter.post('/auth/refresh', async (req, res) => {
  const presented = readRefreshCookie(req);
  if (!presented) {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  const result = await refreshSession(presented);

  // Rotation: the old cookie is replaced, not reused.
  setRefreshCookie(res, result.refreshToken);

  const response: RefreshResponse = result.response;
  res.json(response);
});

authRouter.post('/auth/logout', optionalAuth, async (req, res) => {
  await logout({ refreshToken: readRefreshCookie(req), claims: req.auth });

  clearRefreshCookie(res);

  // 204 whatever the starting state: logging out twice, or without a valid
  // token, is not an error the client can act on.
  res.status(204).end();
});

/**
 * AUTH-02, step one.
 *
 * Always 202 with the same acknowledgement, whether or not the address belongs
 * to an account. This endpoint would otherwise be the easiest account-enumeration
 * oracle in the product: unauthenticated, and a distinguishable response would
 * confirm membership one address at a time.
 */
authRouter.post(
  '/auth/forgot-password',
  forgotPasswordRateLimit,
  validate({ body: forgotPasswordRequestSchema }),
  async (req, res) => {
    const { email } = body(forgotPasswordRequestSchema, req);

    // Never throws for an unknown address — see requestReset.
    await requestReset(email);

    res.status(202).json({ message: FORGOT_PASSWORD_ACK });
  },
);

/** AUTH-02, step two: redeem the token and set the new password. */
authRouter.post(
  '/auth/reset-password',
  resetPasswordRateLimit,
  validate({ body: resetPasswordRequestSchema }),
  async (req, res) => {
    const { token, password } = body(resetPasswordRequestSchema, req);

    await completeReset(token, password);

    // Every session was revoked, so any cookie this browser still holds is dead.
    clearRefreshCookie(res);

    res.status(204).end();
  },
);

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const claims = authenticated(req);
  const response: MeResponse = { user: await currentUser(claims.id) };
  res.json(response);
});
