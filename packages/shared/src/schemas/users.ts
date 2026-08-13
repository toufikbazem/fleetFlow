/**
 * User management contract — USR-01…USR-04.
 *
 * Administrator-only, enforced server-side by `authorize('users', …)`. The
 * matrix in permissions.ts is the authority; these schemas only describe the
 * shapes that cross the wire.
 */

import { z } from 'zod';
import { USER_ROLES } from '../enums.js';
import { paginated, paginationQuerySchema, uuidSchema, optionalField } from './common.js';
import { emailSchema, passwordSchema } from './auth.js';

export const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt', 'lastLoginAt'] as const;

// ---------------------------------------------------------------------------
// Representation
// ---------------------------------------------------------------------------

export const userSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: emailSchema,
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
  /** Null until the invited user has chosen a password (USR-04). */
  lastLoginAt: z.string().nullable(),
  deactivatedAt: z.string().nullable(),
  /**
   * False while an invitation is outstanding. The UI uses it to show "invited"
   * rather than "never signed in", which are different states to an administrator.
   */
  hasUsablePassword: z.boolean(),
  /** Present when this account is linked to a driver record (DRV-04). */
  driverId: uuidSchema.nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

export const userListResponseSchema = paginated(userSchema);
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const userResponseSchema = z.object({ user: userSchema });
export type UserResponse = z.infer<typeof userResponseSchema>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const userListQuerySchema = paginationQuerySchema.extend({
  role: z.enum(USER_ROLES).optional(),
  // Query strings carry text, so the boolean arrives as "true" / "false".
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export const nameSchema = z.string().trim().min(1, 'A name is required').max(120);

export const createUserRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(USER_ROLES),
  /**
   * Omit to send an invitation instead (USR-04). Setting a colleague's password
   * for them means it travels through whatever channel is used to tell them —
   * chat, a sticky note — so the invitation path is the default and this exists
   * for seeding and for administrators who insist.
   */
  password: optionalField(passwordSchema),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    name: optionalField(nameSchema),
    email: optionalField(emailSchema),
    role: optionalField(z.enum(USER_ROLES)),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/** Response to creating a user without a password. */
export const inviteResultSchema = z.object({
  user: userSchema,
  /** False when the invitation email could not be sent — the account still exists. */
  invitationSent: z.boolean(),
});
export type InviteResult = z.infer<typeof inviteResultSchema>;
