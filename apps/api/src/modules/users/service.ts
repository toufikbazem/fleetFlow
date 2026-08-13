/**
 * User management — FF-301 (USR-01…03) and FF-302 (USR-04).
 *
 * Two rules here are not in the PRD but are the difference between a working
 * admin screen and a locked-out installation:
 *
 *   1. An administrator cannot deactivate, delete or demote themselves.
 *   2. The last active administrator cannot be removed by anyone.
 *
 * Without them, one wrong click on a single-admin installation leaves nobody
 * able to manage users — and since user management is admin-only, there is no
 * in-app way back. Recovery would mean editing the database by hand.
 */

import {
  type CreateUserRequest,
  type Paginated,
  type UpdateUserRequest,
  type User,
  type UserListQuery,
} from '@fleetflow/shared';
import bcrypt from 'bcryptjs';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { revokeAccessTokensFor, revokeAllSessions } from '../auth/tokens.js';
import { BCRYPT_COST } from '../auth/service.js';
import { sendInvitation } from './invitations.js';
import {
  countActiveAdmins,
  createUser,
  findUserById,
  listUsers,
  NO_PASSWORD_SENTINEL,
  softDeleteUser,
  updateUser,
} from './repository.js';

const log = childLogger('users');

async function requireUser(id: string): Promise<User> {
  const user = await findUserById(id);
  if (!user) throw new NotFoundError('User');
  return user;
}

/** Blocks the two lockout scenarios described above. */
async function assertNotLastAdmin(target: User, action: string): Promise<void> {
  if (target.role !== 'ADMIN' || !target.isActive) return;
  const remaining = await countActiveAdmins(target.id);
  if (remaining === 0) {
    throw new ConflictError(
      `This is the only active administrator. Promote another user before you ${action} this one.`,
    );
  }
}

function assertNotSelf(actorId: string, targetId: string, action: string): void {
  if (actorId === targetId) {
    throw new ConflictError(`You cannot ${action} your own account.`);
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function list(query: UserListQuery): Promise<Paginated<User>> {
  const { rows, total } = await listUsers(query);
  return { data: rows, page: query.page, pageSize: query.pageSize, total };
}

export async function getById(id: string): Promise<User> {
  return requireUser(id);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateResult {
  user: User;
  invitationSent: boolean;
}

/**
 * USR-01, USR-02, USR-04.
 *
 * With a password, the account is usable immediately. Without one, it is
 * created in an unusable state and an invitation is emailed — the recipient
 * chooses their own password, so it never travels through a chat message.
 */
export async function create(input: CreateUserRequest): Promise<CreateResult> {
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, BCRYPT_COST)
    : NO_PASSWORD_SENTINEL;

  // A duplicate email surfaces as Prisma P2002, which the error layer already
  // maps to 409 naming the field — no pre-check, and therefore no race between
  // checking and inserting.
  const user = await createUser({
    name: input.name,
    email: input.email,
    role: input.role,
    passwordHash,
  });

  let invitationSent = false;
  if (!input.password) {
    invitationSent = await sendInvitation(user);
  }

  log.info({ userId: user.id, role: user.role, invited: !input.password }, 'User created');
  return { user, invitationSent };
}

export async function update(actorId: string, id: string, input: UpdateUserRequest): Promise<User> {
  const target = await requireUser(id);

  // Demoting yourself out of ADMIN is the same lockout as deleting yourself.
  if (input.role && input.role !== target.role && actorId === id && target.role === 'ADMIN') {
    throw new ConflictError('You cannot change your own role.');
  }

  if (input.role && input.role !== 'ADMIN') {
    await assertNotLastAdmin(target, 'demote');
  }

  const updated = await updateUser(id, input);

  /**
   * USR-02 — the change reaches the user's *next* request.
   *
   * Dropping refresh tokens alone is not enough, and used to be all this did:
   * the access token already in the user's hands stays validly signed, so they
   * kept their old permissions for up to a further 15 minutes. Retiring their
   * access tokens closes that window.
   *
   * Their refresh token deliberately survives. The next call 401s, the client's
   * refresh-and-retry path fires, and the new token carries the new role — so
   * the user is not thrown back to the login screen because an administrator
   * corrected a typo in their role.
   */
  if (input.role && input.role !== target.role) {
    await revokeAccessTokensFor(id);
    log.info({ userId: id, from: target.role, to: input.role }, 'Role changed');
  }

  return updated;
}

/**
 * USR-03 — the account stops working; every record it authored stays.
 *
 * Not a delete: maintenance operations and damage reports keep pointing at this
 * user, so the history remains attributed rather than orphaned.
 */
export async function deactivate(actorId: string, id: string): Promise<User> {
  assertNotSelf(actorId, id, 'deactivate');
  const target = await requireUser(id);
  await assertNotLastAdmin(target, 'deactivate');

  if (!target.isActive) return target;

  const updated = await updateUser(id, { isActive: false, deactivatedAt: new Date() });

  // Deactivation must take effect now, not when the token expires. Both halves
  // are needed: the refresh tokens so no new access token can be minted, and the
  // cutoff so the one already issued stops being honoured.
  const ended = await revokeAllSessions(id);
  await revokeAccessTokensFor(id);
  log.info({ userId: id, sessionsEnded: ended }, 'User deactivated');

  return updated;
}

export async function reactivate(id: string): Promise<User> {
  const target = await requireUser(id);
  if (target.isActive) return target;
  log.info({ userId: id }, 'User reactivated');
  return updateUser(id, { isActive: true, deactivatedAt: null });
}

/**
 * USR-01 delete, reconciled with Q6 soft delete.
 *
 * The row is retained and hidden. Authored records keep their attribution, so
 * "who completed this maintenance job" is still answerable a year later — which
 * is the whole reason the client chose soft delete.
 */
export async function remove(actorId: string, id: string): Promise<void> {
  assertNotSelf(actorId, id, 'delete');
  const target = await requireUser(id);
  await assertNotLastAdmin(target, 'delete');

  if (target.driverId) {
    // The driver record would keep a dangling link. Unlinking is an explicit
    // act on the driver, not a side effect of deleting an account.
    throw new ConflictError(
      'This account is linked to a driver record. Unlink it from the driver first.',
    );
  }

  await softDeleteUser(id);
  const ended = await revokeAllSessions(id);
  await revokeAccessTokensFor(id);
  log.info({ userId: id, sessionsEnded: ended }, 'User deleted');
}

/** Re-sends an invitation to an account that has not yet chosen a password. */
export async function resendInvitation(id: string): Promise<boolean> {
  const user = await requireUser(id);

  if (user.hasUsablePassword) {
    throw new ValidationError(
      [],
      'This user has already set a password. Ask them to use "forgot password" instead.',
    );
  }

  return sendInvitation(user);
}
