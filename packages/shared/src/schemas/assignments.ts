/**
 * Assignment contract — DRV-02, DRV-03, VEH-03.
 *
 * An assignment is a period, not a pointer. Reassigning a vehicle closes the
 * current row and opens a new one, so "who drove this van in March" stays
 * answerable — which is what the driver-assignment report (RPT-04) reads.
 *
 * Decision Q5: at most one open assignment per vehicle, enforced by a partial
 * unique index in the database rather than by a service-layer check.
 */

import { z } from 'zod';
import {
  dateOnlySchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
  optionalField,
} from './common.js';

export const assignmentSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  driverId: uuidSchema,
  driverName: z.string(),
  startDate: z.string(),
  /** Null while the assignment is open. */
  endDate: z.string().nullable(),
  endedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentListResponseSchema = paginated(assignmentSchema);
export type AssignmentListResponse = z.infer<typeof assignmentListResponseSchema>;

export const assignmentResponseSchema = z.object({ assignment: assignmentSchema });
export type AssignmentResponse = z.infer<typeof assignmentResponseSchema>;

export const assignmentListQuerySchema = paginationQuerySchema.extend({
  vehicleId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const createAssignmentRequestSchema = z.object({
  vehicleId: uuidSchema,
  driverId: uuidSchema,
  /** Defaults to today on the server, so the client need not guess a timezone. */
  startDate: optionalField(dateOnlySchema),
  /**
   * Reassignment is the normal case, so it is the default: the vehicle's open
   * assignment is closed as part of the same transaction. Setting this false
   * makes a reassignment fail loudly instead, for a caller that wants to be
   * told rather than to have the handover performed for them.
   */
  closeExisting: z.boolean().default(true),
});
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

export const closeAssignmentRequestSchema = z.object({
  endDate: optionalField(dateOnlySchema),
});
export type CloseAssignmentRequest = z.infer<typeof closeAssignmentRequestSchema>;
