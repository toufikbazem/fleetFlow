/**
 * Damage contract — DMG-01…04.
 *
 * The one place in FleetFlow where a driver writes. The permission matrix gives
 * them `W_REPORT`: create and read, scoped to the vehicle they hold. They
 * cannot edit or withdraw a report once filed — the fleet manager's queue must
 * not change underneath them.
 */

import { z } from 'zod';
import { DAMAGE_SEVERITIES, DAMAGE_STATUSES, MAINTENANCE_STATUSES } from '../enums.js';
import { paginated, paginationQuerySchema, uuidSchema, optionalField } from './common.js';

// ---------------------------------------------------------------------------
// Representation
// ---------------------------------------------------------------------------

/** DMG-02 — the job raised from this report, if one was. */
export const linkedMaintenanceSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(MAINTENANCE_STATUSES),
  costTotal: z.string(),
  currency: z.string(),
  completedAt: z.string().nullable(),
  mechanicName: z.string().nullable(),
});

export const damageSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  reportedById: uuidSchema,
  reportedByName: z.string(),
  driverId: uuidSchema.nullable(),
  driverName: z.string().nullable(),
  description: z.string(),
  severity: z.enum(DAMAGE_SEVERITIES),
  occurredAt: z.string(),
  location: z.string().nullable(),
  status: z.enum(DAMAGE_STATUSES),
  archivedAt: z.string().nullable(),
  maintenanceOp: linkedMaintenanceSchema.nullable(),
  photoCount: z.number().int(),
  createdAt: z.string(),
});
export type Damage = z.infer<typeof damageSchema>;

export const damageListResponseSchema = paginated(damageSchema);
export type DamageListResponse = z.infer<typeof damageListResponseSchema>;

export const damageResponseSchema = z.object({ damage: damageSchema });
export type DamageResponse = z.infer<typeof damageResponseSchema>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const damageListQuerySchema = paginationQuerySchema.extend({
  vehicleId: uuidSchema.optional(),
  status: z.enum(DAMAGE_STATUSES).optional(),
  severity: z.enum(DAMAGE_SEVERITIES).optional(),
  /** The triage queue: everything still awaiting a decision. */
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type DamageListQuery = z.infer<typeof damageListQuerySchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * DMG-03.
 *
 * `occurredAt` is a timestamp rather than a date: a driver reporting a
 * kerbed wheel at the roadside knows roughly when it happened, and "this
 * morning" versus "last Tuesday" changes who was driving.
 */
export const createDamageRequestSchema = z.object({
  vehicleId: uuidSchema,
  description: z
    .string()
    .trim()
    .min(10, 'Describe what happened in a little more detail')
    .max(2000),
  severity: z.enum(DAMAGE_SEVERITIES).default('MEDIUM'),
  occurredAt: optionalField(z.string().datetime({ offset: true })),
  location: optionalField(z.string().trim().max(160)),
});
export type CreateDamageRequest = z.infer<typeof createDamageRequestSchema>;

export const updateDamageRequestSchema = z
  .object({
    description: optionalField(z.string().trim().min(10).max(2000)),
    severity: optionalField(z.enum(DAMAGE_SEVERITIES)),
    occurredAt: optionalField(z.string().datetime({ offset: true })),
    location: optionalField(z.string().trim().max(160)),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateDamageRequest = z.infer<typeof updateDamageRequestSchema>;

/**
 * Triage. LINKED is not accepted here — see DAMAGE_TRANSITIONS: a report
 * becomes LINKED only by being converted into a job.
 */
export const changeDamageStatusRequestSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'RESOLVED', 'REJECTED']),
  note: optionalField(z.string().trim().max(500)),
});
export type ChangeDamageStatusRequest = z.infer<typeof changeDamageStatusRequestSchema>;

/** DMG-02 — turns a report into an unexpected maintenance job. */
export const convertToMaintenanceRequestSchema = z.object({
  title: optionalField(z.string().trim().min(1, 'Give the job a title').max(160)),
  mechanicId: optionalField(uuidSchema),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
});
export type ConvertToMaintenanceRequest = z.infer<typeof convertToMaintenanceRequestSchema>;
