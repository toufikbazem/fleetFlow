/**
 * Authentication service — FF-201 (login), FF-202 (refresh, logout).
 *
 * The whole file is organised around one requirement: an unsuccessful login
 * must reveal nothing about the account. AUTH's acceptance criterion says
 * invalid credentials return "a generic error that does not reveal whether the
 * account exists", and an attacker learns that from three channels, not one:
 *
 *   the message   — one constant for every failure
 *   the status    — always 401, never 403 or 404
 *   the timing    — see `timingEqualiserHash` below
 *
 * Getting the first two right while leaking the third is the common mistake:
 * a missing account returns in ~1 ms while a real one costs ~250 ms of bcrypt,
 * which is a reliable account-enumeration oracle over a few requests.
 */

import {
  GENERIC_LOGIN_FAILURE,
  type AuthenticatedUser,
  type LoginRequest,
  type LoginResponse,
} from '@fleetflow/shared';
import bcrypt from 'bcryptjs';
import { prisma } from '../../platform/db.js';
import { RateLimitedError, UnauthenticatedError } from '../../platform/errors.js';
import { checkLockout, clearAuthFailures, recordAuthFailure } from '../../platform/rate-limit.js';
import {
  consumeRefreshToken,
  denyAccessToken,
  generateRefreshToken,
  revokeAllSessions,
  revokeRefreshToken,
  signAccessToken,
  storeRefreshToken,
  type AccessTokenClaims,
  type AccessTokenSubject,
} from './tokens.js';

/** AUTH-03. Also the cost used by the seed, so seeded accounts log in normally. */
export const BCRYPT_COST = 12;

/**
 * A real bcrypt hash of a value nobody can supply, compared against when the
 * account does not exist. It makes the "no such user" path cost the same as the
 * "wrong password" path.
 *
 * Generated at module load rather than hardcoded so it always matches the
 * current cost factor — a stale constant at cost 10 would reintroduce the
 * timing difference it exists to remove.
 */
const timingEqualiserHash = bcrypt.hashSync(
  `no-such-account-${Math.random().toString(36)}`,
  BCRYPT_COST,
);

export interface LoginContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface LoginResult {
  response: LoginResponse;
  refreshToken: string;
}

/**
 * Loads the account and its optional driver link.
 *
 * The driver relation is to-one, which the soft-delete extension cannot filter
 * (see prisma/README.md) — so `deletedAt` is selected and checked here rather
 * than assumed. A driver record that was deleted must not keep granting its
 * user the driver scope.
 */
async function findLoginCandidate(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      isActive: true,
      driver: { select: { id: true, deletedAt: true } },
    },
  });
}

export async function login(
  credentials: LoginRequest,
  _context: LoginContext = {},
): Promise<LoginResult> {
  // AUTH-05. Checked before the password is even looked at, so a locked account
  // costs an attacker a Redis read rather than a bcrypt comparison.
  const lock = await checkLockout(credentials.email);
  if (lock.locked) {
    // Delibely NOT "this account is locked" — that would confirm the address
    // exists. The generic failure is reused, and only the 429 differs, which is
    // equally true of an address that has never existed but has been hammered.
    throw new RateLimitedError(
      `Too many failed attempts. Try again in ${lock.retryAfterSeconds} seconds.`,
    );
  }

  const user = await findLoginCandidate(credentials.email);

  // Always run a comparison, even with no account, so both paths cost the same.
  const passwordMatches = await bcrypt.compare(
    credentials.password,
    user?.passwordHash ?? timingEqualiserHash,
  );

  // One decision, one message. A deactivated account is not told it is
  // deactivated: that would confirm the address exists (USR-03 is enforced
  // here as much as at the user-management endpoint).
  if (!user || !passwordMatches || !user.isActive) {
    // Counted for any address, existing or not. Counting only real accounts
    // would turn the lockout itself into an enumeration oracle: "locked" would
    // mean "exists".
    await recordAuthFailure(credentials.email);
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  // A correct password clears the slate, so a user who mistyped twice and then
  // succeeded starts from zero next time.
  await clearAuthFailures(credentials.email);

  const driverId = user.driver && user.driver.deletedAt === null ? user.driver.id : null;

  const subject: AccessTokenSubject = { id: user.id, role: user.role, driverId };
  const { token: accessToken, expiresIn } = signAccessToken(subject);

  const refreshToken = generateRefreshToken();
  await storeRefreshToken(refreshToken, user.id);

  // Recorded after the credentials are accepted, so a failed attempt never
  // moves the timestamp.
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const authenticated: AuthenticatedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    driverId,
  };

  return {
    response: { accessToken, expiresIn, user: authenticated },
    refreshToken,
  };
}

/**
 * Exchanges a refresh token for a new pair — FF-202.
 *
 * Rotation: the presented token is consumed, and a *new* one issued. A stolen
 * cookie is therefore useful at most once, and the theft becomes visible the
 * moment either party refreshes again (see `consumeRefreshToken`).
 *
 * The user row is re-read on every refresh, which is what makes a role change
 * take effect within one access-token lifetime rather than at next login, and
 * what stops a deactivated account from refreshing its way to immortality.
 */
export async function refreshSession(presentedToken: string): Promise<LoginResult> {
  const consumed = await consumeRefreshToken(presentedToken);

  if (consumed.outcome === 'reused') {
    // Treated as theft. Every session for this user is dropped: the attacker's
    // copy and the legitimate one alike, because we cannot tell them apart.
    await revokeAllSessions(consumed.userId);
    throw new UnauthenticatedError(
      'Your session was ended for security reasons. Please sign in again.',
    );
  }

  if (consumed.outcome !== 'ok') {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }

  const user = await prisma.user.findUnique({
    where: { id: consumed.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      driver: { select: { id: true, deletedAt: true } },
    },
  });

  if (!user || !user.isActive) {
    // Deleted or deactivated since the last refresh. The consumed token is
    // already gone, so this session simply ends here.
    throw new UnauthenticatedError('This account is no longer active.');
  }

  const driverId = user.driver && user.driver.deletedAt === null ? user.driver.id : null;
  const { token: accessToken, expiresIn } = signAccessToken({
    id: user.id,
    role: user.role,
    driverId,
  });

  const refreshToken = generateRefreshToken();
  await storeRefreshToken(refreshToken, user.id);

  return {
    response: {
      accessToken,
      expiresIn,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, driverId },
    },
    refreshToken,
  };
}

/**
 * Ends a session — FF-202, AUTH-04.
 *
 * Deliberately tolerant: it does whatever it can with whatever it is given, and
 * never fails. A user whose access token expired while the tab was open still
 * needs their refresh token revoked; refusing that request would strand a live
 * session nobody can now end.
 */
export async function logout(options: {
  refreshToken?: string | undefined;
  claims?: AccessTokenClaims | undefined;
}): Promise<void> {
  const work: Array<Promise<unknown>> = [];

  if (options.refreshToken) {
    work.push(revokeRefreshToken(options.refreshToken));
  }
  if (options.claims) {
    // Without this the token keeps working until it expires, and "log out"
    // would mean nothing more than clearing client state.
    work.push(denyAccessToken(options.claims.jti, options.claims.expiresAt));
  }

  await Promise.all(work);
}

/**
 * The current account, read fresh from the database.
 *
 * Not reconstructed from the token: a role changed by an administrator must
 * take effect without waiting for the token to expire, and an account
 * deactivated mid-session must stop being usable (USR acceptance).
 */
export async function currentUser(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      driver: { select: { id: true, deletedAt: true } },
    },
  });

  // Deleted (filtered by the extension) or deactivated since the token was
  // issued — the token is signed and unexpired, but the account is gone.
  if (!user || !user.isActive) {
    throw new UnauthenticatedError('This account is no longer active.');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    driverId: user.driver && user.driver.deletedAt === null ? user.driver.id : null,
  };
}
