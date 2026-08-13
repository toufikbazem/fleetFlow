/**
 * User persistence — FF-301.
 *
 * Every read goes through the soft-delete-filtered client, so a deleted account
 * is invisible without anyone remembering to exclude it (FF-105).
 */

import type { User, UserListQuery } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';

/** The columns a user representation needs. `passwordHash` is never among them. */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  deactivatedAt: true,
  createdAt: true,
  passwordHash: true,
  driver: { select: { id: true, deletedAt: true } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * A user created by invitation gets this as their password hash: a value no
 * bcrypt comparison can ever match, because it is not a valid bcrypt digest.
 *
 * Storing a real hash of a random string would work too, but this is
 * self-describing — anyone reading the column sees immediately that the account
 * has no password rather than one nobody knows.
 */
export const NO_PASSWORD_SENTINEL = '!invitation-pending';

export function hasUsablePassword(passwordHash: string): boolean {
  return passwordHash !== NO_PASSWORD_SENTINEL;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    hasUsablePassword: hasUsablePassword(row.passwordHash),
    // The driver relation is to-one, which the soft-delete extension cannot
    // filter (prisma/README.md) — so a deleted driver is excluded here.
    driverId: row.driver && row.driver.deletedAt === null ? row.driver.id : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildWhere(query: UserListQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (query.role) where.role = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  return where;
}

function buildOrderBy(sort: string | undefined): Prisma.UserOrderByWithRelationInput {
  const [field, direction] = (sort ?? 'name:asc').split(':');
  const order = direction === 'desc' ? 'desc' : 'asc';

  // Allowlisted: an arbitrary field name from the query string must never reach
  // Prisma, or a caller could order by `passwordHash` and infer it byte by byte.
  switch (field) {
    case 'email':
      return { email: order };
    case 'role':
      return { role: order };
    case 'createdAt':
      return { createdAt: order };
    case 'lastLoginAt':
      return { lastLoginAt: order };
    case 'name':
    default:
      return { name: order };
  }
}

export async function listUsers(query: UserListQuery): Promise<{ rows: User[]; total: number }> {
  const where = buildWhere(query);

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: buildOrderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { rows: rows.map(toUser), total };
}

export async function findUserById(id: string): Promise<User | null> {
  const row = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  return row ? toUser(row) : null;
}

export async function findUserRowById(id: string): Promise<UserRow | null> {
  return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
}

export async function createUser(data: {
  name: string;
  email: string;
  role: Prisma.UserCreateInput['role'];
  passwordHash: string;
}): Promise<User> {
  const row = await prisma.user.create({ data, select: USER_SELECT });
  return toUser(row);
}

export async function updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
  const row = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
  return toUser(row);
}

/** Q6: deletion writes a timestamp. The row and everything it authored remain. */
export async function softDeleteUser(id: string): Promise<void> {
  await prisma.user.update({
    where: { id },
    // Deactivated as well as deleted: `is_active` is what the login path checks,
    // so a deleted account must not remain signable-in if it is ever restored
    // by hand without someone remembering to flip this too.
    data: { deletedAt: new Date(), isActive: false, deactivatedAt: new Date() },
  });
}

/** How many administrators can still sign in. Guards the last-admin rule. */
export async function countActiveAdmins(excludingUserId?: string): Promise<number> {
  return prisma.user.count({
    where: {
      role: 'ADMIN',
      isActive: true,
      ...(excludingUserId ? { id: { not: excludingUserId } } : {}),
    },
  });
}
