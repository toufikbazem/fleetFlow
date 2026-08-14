/**
 * Maintenance contract — MNT-01…07.
 *
 * Two entities that are easy to confuse:
 *
 *   Plan       a rule. "Every 15 000 km, service this vehicle type."
 *   Operation  a job. "Service the Boxer, due at 45 000 km, assigned to Samir."
 *
 * The trigger engine (FF-503) turns the first into the second. Everything a
 * mechanic works on, and everything a cost report counts, is an operation.
 */

import { z } from 'zod';
import { MAINTENANCE_KINDS, MAINTENANCE_STATUSES, TRIGGER_TYPES } from '../enums.js';
import {
  dateOnlySchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
  optionalField,
} from './common.js';

// ---------------------------------------------------------------------------
// Plans — MNT-04
// ---------------------------------------------------------------------------

export const maintenancePlanSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Exactly one of these is set — a CHECK constraint enforces it. */
  vehicleId: uuidSchema.nullable(),
  vehiclePlate: z.string().nullable(),
  vehicleTypeId: uuidSchema.nullable(),
  vehicleTypeName: z.string().nullable(),
  triggerType: z.enum(TRIGGER_TYPES),
  intervalDays: z.number().int().nullable(),
  intervalKm: z.number().int().nullable(),
  noticeDays: z.number().int(),
  noticeKm: z.number().int(),
  isActive: z.boolean(),
  /** How many vehicles this plan currently applies to. */
  appliesTo: z.number().int(),
  createdAt: z.string(),
});
export type MaintenancePlan = z.infer<typeof maintenancePlanSchema>;

export const maintenancePlanListResponseSchema = paginated(maintenancePlanSchema);
export type MaintenancePlanListResponse = z.infer<typeof maintenancePlanListResponseSchema>;

export const maintenancePlanResponseSchema = z.object({ plan: maintenancePlanSchema });
export type MaintenancePlanResponse = z.infer<typeof maintenancePlanResponseSchema>;

export const maintenancePlanListQuerySchema = paginationQuerySchema.extend({
  vehicleId: uuidSchema.optional(),
  vehicleTypeId: uuidSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type MaintenancePlanListQuery = z.infer<typeof maintenancePlanListQuerySchema>;

/**
 * The interval must match the trigger, or the engine has nothing to compute
 * from. The database enforces the same rule, so a plan cannot be created that
 * silently never fires — which is the failure mode nobody notices.
 */
export const createMaintenancePlanRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'A name is required').max(120),
    description: optionalField(z.string().trim().max(1000)),
    vehicleId: optionalField(uuidSchema),
    vehicleTypeId: optionalField(uuidSchema),
    triggerType: z.enum(TRIGGER_TYPES),
    intervalDays: optionalField(z.coerce.number().int().positive()),
    intervalKm: optionalField(z.coerce.number().int().positive()),
    noticeDays: z.coerce.number().int().positive().default(14),
    noticeKm: z.coerce.number().int().positive().default(500),
  })
  .refine((value) => Boolean(value.vehicleId) !== Boolean(value.vehicleTypeId), {
    message: 'Choose either one vehicle or one vehicle type, not both',
    path: ['vehicleTypeId'],
  })
  .refine((value) => value.triggerType !== 'DATE' || value.intervalDays !== undefined, {
    message: 'A date-based plan needs an interval in days',
    path: ['intervalDays'],
  })
  .refine((value) => value.triggerType !== 'MILEAGE' || value.intervalKm !== undefined, {
    message: 'A mileage-based plan needs an interval in kilometres',
    path: ['intervalKm'],
  })
  .refine(
    (value) =>
      value.triggerType !== 'BOTH' ||
      (value.intervalDays !== undefined && value.intervalKm !== undefined),
    { message: 'A plan triggered by both needs both intervals', path: ['intervalKm'] },
  );
export type CreateMaintenancePlanRequest = z.infer<typeof createMaintenancePlanRequestSchema>;

export const updateMaintenancePlanRequestSchema = z.object({
  name: optionalField(z.string().trim().min(1).max(120)),
  description: optionalField(z.string().trim().max(1000)),
  intervalDays: optionalField(z.coerce.number().int().positive()),
  intervalKm: optionalField(z.coerce.number().int().positive()),
  noticeDays: optionalField(z.coerce.number().int().positive()),
  noticeKm: optionalField(z.coerce.number().int().positive()),
  isActive: optionalField(z.boolean()),
});
export type UpdateMaintenancePlanRequest = z.infer<typeof updateMaintenancePlanRequestSchema>;

// ---------------------------------------------------------------------------
// Operations — MNT-01, MNT-05, MNT-06, MNT-07
// ---------------------------------------------------------------------------

export const maintenanceOpSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  planId: uuidSchema.nullable(),
  planName: z.string().nullable(),
  damageId: uuidSchema.nullable(),
  kind: z.enum(MAINTENANCE_KINDS),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(MAINTENANCE_STATUSES),
  dueDate: z.string().nullable(),
  dueMileage: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedMileage: z.number().int().nullable(),
  mechanicId: uuidSchema.nullable(),
  mechanicName: z.string().nullable(),
  costParts: z.string(),
  costLabour: z.string(),
  costTotal: z.string(),
  currency: z.string(),
  vendor: z.string().nullable(),
  /** Days until due; negative once past. Null when the trigger is mileage-only. */
  daysUntilDue: z.number().int().nullable(),
  createdAt: z.string(),
});
export type MaintenanceOp = z.infer<typeof maintenanceOpSchema>;

export const maintenanceOpListResponseSchema = paginated(maintenanceOpSchema);
export type MaintenanceOpListResponse = z.infer<typeof maintenanceOpListResponseSchema>;

export const maintenanceOpResponseSchema = z.object({ operation: maintenanceOpSchema });
export type MaintenanceOpResponse = z.infer<typeof maintenanceOpResponseSchema>;

export const maintenanceOpListQuerySchema = paginationQuerySchema.extend({
  vehicleId: uuidSchema.optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  mechanicId: uuidSchema.optional(),
  /** The mechanic's own queue, without them needing to know their user id. */
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** Everything not yet completed — the operational view. */
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /**
   * The dashboard's own definition of due (DSH-04, DSH-05).
   *
   * Distinct from `status=OVERDUE`, and deliberately so: it also catches work
   * whose due date or mileage has passed but which the daily sweep has not
   * relabelled yet, and it understands mileage thresholds, which no status
   * filter can. This is what makes a dashboard counter drill through to exactly
   * the rows it counted.
   */
  due: z.enum(['upcoming', 'overdue']).optional(),
  dueBefore: dateOnlySchema.optional(),
});
export type MaintenanceOpListQuery = z.infer<typeof maintenanceOpListQuerySchema>;

const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount such as 250.00');

export const createMaintenanceOpRequestSchema = z
  .object({
    vehicleId: uuidSchema,
    title: z.string().trim().min(1, 'A title is required').max(160),
    description: optionalField(z.string().trim().max(2000)),
    kind: z.enum(MAINTENANCE_KINDS).default('UNEXPECTED'),
    dueDate: optionalField(dateOnlySchema),
    dueMileage: optionalField(z.coerce.number().int().positive()),
    mechanicId: optionalField(uuidSchema),
    costParts: optionalField(moneySchema),
    costLabour: optionalField(moneySchema),
    vendor: optionalField(z.string().trim().max(120)),
  })
  // Mirrors the database CHECK: scheduled work must be due by something, or it
  // will never appear in an upcoming list and never become overdue.
  .refine(
    (value) =>
      value.kind !== 'SCHEDULED' || value.dueDate !== undefined || value.dueMileage !== undefined,
    { message: 'Scheduled work needs a due date or a due mileage', path: ['dueDate'] },
  );
export type CreateMaintenanceOpRequest = z.infer<typeof createMaintenanceOpRequestSchema>;

export const updateMaintenanceOpRequestSchema = z.object({
  title: optionalField(z.string().trim().min(1).max(160)),
  description: optionalField(z.string().trim().max(2000)),
  dueDate: optionalField(dateOnlySchema),
  dueMileage: optionalField(z.coerce.number().int().positive()),
  costParts: optionalField(moneySchema),
  costLabour: optionalField(moneySchema),
  vendor: optionalField(z.string().trim().max(120)),
});
export type UpdateMaintenanceOpRequest = z.infer<typeof updateMaintenanceOpRequestSchema>;

/**
 * MNT-06. Completion carries the odometer and the final costs, because those
 * are the moment's facts — asking for them later means guessing.
 */
export const changeMaintenanceStatusRequestSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES),
  completedMileage: optionalField(z.coerce.number().int().min(0)),
  costParts: optionalField(moneySchema),
  costLabour: optionalField(moneySchema),
});
export type ChangeMaintenanceStatusRequest = z.infer<typeof changeMaintenanceStatusRequestSchema>;

/** MNT-07. Null unassigns. */
export const assignMechanicRequestSchema = z.object({
  mechanicId: uuidSchema.nullable(),
});
export type AssignMechanicRequest = z.infer<typeof assignMechanicRequestSchema>;

// ---------------------------------------------------------------------------
// Trigger engine — FF-503
// ---------------------------------------------------------------------------

export const triggerRunResultSchema = z.object({
  ranAt: z.string(),
  plansEvaluated: z.number().int(),
  vehiclesEvaluated: z.number().int(),
  operationsCreated: z.number().int(),
  markedOverdue: z.number().int(),
  /** Created this run, for the operator to see what the job actually did. */
  created: z.array(
    z.object({
      operationId: uuidSchema,
      plate: z.string(),
      planName: z.string(),
      dueDate: z.string().nullable(),
      dueMileage: z.number().int().nullable(),
    }),
  ),
});
export type TriggerRunResult = z.infer<typeof triggerRunResultSchema>;
