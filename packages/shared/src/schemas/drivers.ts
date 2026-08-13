/**
 * Driver contract — DRV-01…DRV-04.
 *
 * A driver is a person the fleet employs, not an account. The two are separate
 * records because most drivers never sign in: DRV-04 makes the login link
 * optional, and the PRD's own permission matrix gives the Driver role read
 * access to "self" only.
 */

import { z } from 'zod';
import { DRIVER_STATUSES } from '../enums.js';
import {
  dateOnlySchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
  optionalField,
} from './common.js';
import { nameSchema } from './users.js';

export const DRIVER_SORT_FIELDS = ['lastName', 'firstName', 'licenceExpiry', 'createdAt'] as const;

// ---------------------------------------------------------------------------
// Representation
// ---------------------------------------------------------------------------

/** The vehicle a driver currently holds. Q5 allows at most one open per vehicle. */
export const driverAssignmentSummarySchema = z.object({
  vehicleId: uuidSchema,
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  startDate: z.string(),
});

export const driverSchema = z.object({
  id: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  licenceNo: z.string(),
  licenceCategory: z.string().nullable(),
  licenceExpiry: z.string().nullable(),
  phone: z.string().nullable(),
  hiredAt: z.string().nullable(),
  status: z.enum(DRIVER_STATUSES),
  /** DRV-04 — null when this driver has no login account. */
  userId: uuidSchema.nullable(),
  userEmail: z.string().nullable(),
  /** Open assignments only; closed ones are history (DRV-03). */
  currentAssignments: z.array(driverAssignmentSummarySchema),
  createdAt: z.string(),
});
export type Driver = z.infer<typeof driverSchema>;

export const driverListResponseSchema = paginated(driverSchema);
export type DriverListResponse = z.infer<typeof driverListResponseSchema>;

export const driverResponseSchema = z.object({ driver: driverSchema });
export type DriverResponse = z.infer<typeof driverResponseSchema>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const driverListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(DRIVER_STATUSES).optional(),
  /** Drivers whose licence expires on or before this date — a compliance view. */
  licenceExpiringBefore: dateOnlySchema.optional(),
  hasVehicle: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type DriverListQuery = z.infer<typeof driverListQuerySchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const licenceNoSchema = z.string().trim().min(1, 'A licence number is required').max(60);
const phoneSchema = z.string().trim().max(40);

export const createDriverRequestSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  licenceNo: licenceNoSchema,
  licenceCategory: optionalField(z.string().trim().max(20)),
  licenceExpiry: optionalField(dateOnlySchema),
  phone: optionalField(phoneSchema),
  hiredAt: optionalField(dateOnlySchema),
  status: z.enum(DRIVER_STATUSES).default('ACTIVE'),
  /**
   * Optional link to an existing account. The account must hold the DRIVER role
   * and must not already belong to another driver — both checked server-side.
   */
  userId: optionalField(uuidSchema.nullable()),
});
export type CreateDriverRequest = z.infer<typeof createDriverRequestSchema>;

export const updateDriverRequestSchema = createDriverRequestSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateDriverRequest = z.infer<typeof updateDriverRequestSchema>;
