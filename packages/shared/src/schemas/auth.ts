/**
 * Authentication contract — AUTH-01…AUTH-06.
 *
 * The refresh token deliberately appears in no schema here: it travels only as
 * an httpOnly cookie, so it is never readable by JavaScript and never part of
 * a JSON body the client could accidentally persist.
 */

import { z } from 'zod';
import { USER_ROLES } from '../enums.js';
import { uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const emailSchema = z.string().trim().toLowerCase().email().max(254); // RFC 5321 maximum path length

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Length over composition rules. Character-class requirements push users toward
 * predictable substitutions and shorter secrets; a 12-character floor with a
 * generous ceiling is the stronger constraint, and bcrypt (AUTH-03) is applied
 * to whatever passes.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH);

// ---------------------------------------------------------------------------
// Login — AUTH-01
// ---------------------------------------------------------------------------

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing account whose password predates a policy
  // change must still be able to sign in. The floor is enforced where passwords
  // are *set*, not where they are presented.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authenticatedUserSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: emailSchema,
  role: z.enum(USER_ROLES),
  /** Present only when this user is linked to a driver record (DRV-04). */
  driverId: uuidSchema.nullable(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until `accessToken` expires; the client refreshes ahead of it. */
  expiresIn: z.number().int().positive(),
  user: authenticatedUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * The one message returned for a wrong password, an unknown address and a
 * deactivated account alike. AUTH acceptance: the response must not reveal
 * whether an account exists.
 */
export const GENERIC_LOGIN_FAILURE = 'Invalid email or password.' as const;

// ---------------------------------------------------------------------------
// Session lifecycle — AUTH-04
// ---------------------------------------------------------------------------

export const refreshResponseSchema = loginResponseSchema;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const meResponseSchema = z.object({ user: authenticatedUserSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;

// ---------------------------------------------------------------------------
// Password reset — AUTH-02
// ---------------------------------------------------------------------------

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/**
 * Always 202 with this message, whether or not the address is known — the same
 * enumeration defence as the login failure above.
 */
export const FORGOT_PASSWORD_ACK =
  'If that address belongs to an account, a reset link is on its way.' as const;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Minutes a reset link stays valid before it is refused (AUTH-02). */
export const PASSWORD_RESET_TTL_MINUTES = 60;

// ---------------------------------------------------------------------------
// Changing a password while signed in
// ---------------------------------------------------------------------------

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
