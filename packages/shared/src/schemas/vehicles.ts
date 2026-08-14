/**
 * Vehicle contract — VEH-01…06.
 *
 * The hub entity: maintenance, documents and damages all hang off it, and the
 * detail view (VEH-02) is the screen a fleet manager lives in.
 */

import { z } from 'zod';
import {
  DOCUMENT_STATUSES,
  MAINTENANCE_STATUSES,
  MILEAGE_SOURCES,
  VEHICLE_STATUSES,
} from '../enums.js';
import {
  dateOnlySchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
  optionalField,
} from './common.js';

export const VEHICLE_SORT_FIELDS = [
  'plate',
  'make',
  'year',
  'currentMileage',
  'status',
  'createdAt',
] as const;

// ---------------------------------------------------------------------------
// Representation
// ---------------------------------------------------------------------------

export const vehicleTypeSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
});
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

/** The current holder, denormalised onto the vehicle for list rendering. */
export const vehicleDriverSummarySchema = z.object({
  driverId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  assignmentId: uuidSchema,
  startDate: z.string(),
});

export const vehicleSchema = z.object({
  id: uuidSchema,
  plate: z.string(),
  vin: z.string().nullable(),
  make: z.string(),
  model: z.string(),
  year: z.number().int().nullable(),
  vehicleTypeId: uuidSchema.nullable(),
  vehicleTypeName: z.string().nullable(),
  status: z.enum(VEHICLE_STATUSES),
  currentMileage: z.number().int(),
  purchaseDate: z.string().nullable(),
  /** Decimal columns cross the wire as strings; see lib/format on the client. */
  purchasePrice: z.string().nullable(),
  insuranceValue: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: z.string().nullable(),
  /** Q5 — at most one open assignment, so this is a single value or null. */
  currentDriver: vehicleDriverSummarySchema.nullable(),
  createdAt: z.string(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const vehicleListResponseSchema = paginated(vehicleSchema);
export type VehicleListResponse = z.infer<typeof vehicleListResponseSchema>;

export const vehicleResponseSchema = z.object({ vehicle: vehicleSchema });
export type VehicleResponse = z.infer<typeof vehicleResponseSchema>;

export const vehicleTypeListResponseSchema = z.object({ data: z.array(vehicleTypeSchema) });
export type VehicleTypeListResponse = z.infer<typeof vehicleTypeListResponseSchema>;

// ---------------------------------------------------------------------------
// Queries — VEH-04
// ---------------------------------------------------------------------------

export const vehicleListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VEHICLE_STATUSES).optional(),
  vehicleTypeId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
  /**
   * Archived vehicles are hidden from operational lists by default (VEH-06
   * acceptance) while remaining fully present in reports and history.
   */
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  unassigned: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Normalised to upper case without spaces so "12345-a-6" and "12345 A 6" cannot
 * both exist. The plate is how humans identify a vehicle; two records for one
 * van is the failure mode this prevents.
 */
export const plateSchema = z
  .string()
  .trim()
  .min(1, 'A plate is required')
  .max(20)
  .transform((value) => value.toUpperCase().replace(/\s+/g, ''));

export const vinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(17, 'A VIN is exactly 17 characters')
  // I, O and Q are excluded from the VIN alphabet to avoid confusion with 1 and 0.
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'That is not a valid VIN');

const moneySchema = optionalField(
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount such as 12500.00'),
);

export const createVehicleRequestSchema = z.object({
  plate: plateSchema,
  vin: optionalField(vinSchema),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: optionalField(
    z.coerce
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
  ),
  vehicleTypeId: optionalField(uuidSchema),
  currentMileage: z.coerce.number().int().min(0).default(0),
  purchaseDate: optionalField(dateOnlySchema),
  purchasePrice: moneySchema,
  insuranceValue: moneySchema,
  notes: optionalField(z.string().trim().max(2000)),
});
export type CreateVehicleRequest = z.infer<typeof createVehicleRequestSchema>;

export const updateVehicleRequestSchema = createVehicleRequestSchema
  .omit({ currentMileage: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateVehicleRequest = z.infer<typeof updateVehicleRequestSchema>;

/**
 * Status changes go through their own endpoint rather than the general update.
 *
 * VEH-06 is a lifecycle with legal transitions, and archiving has consequences
 * beyond setting a column — it removes the vehicle from operational lists. That
 * is not something to trigger by including a field in a form PATCH.
 */
export const changeVehicleStatusRequestSchema = z.object({
  status: z.enum(VEHICLE_STATUSES),
  reason: optionalField(z.string().trim().max(500)),
});
export type ChangeVehicleStatusRequest = z.infer<typeof changeVehicleStatusRequestSchema>;

// ---------------------------------------------------------------------------
// Mileage — VEH-05
// ---------------------------------------------------------------------------

export const mileageReadingSchema = z.object({
  id: uuidSchema,
  mileage: z.number().int(),
  recordedAt: z.string(),
  recordedByName: z.string().nullable(),
  source: z.enum(MILEAGE_SOURCES),
  note: z.string().nullable(),
});
export type MileageReading = z.infer<typeof mileageReadingSchema>;

export const recordMileageRequestSchema = z
  .object({
    mileage: z.coerce.number().int().min(0),
    note: optionalField(z.string().trim().max(500)),
    /**
     * An odometer only goes up, so a lower reading is refused by default. It is
     * occasionally legitimate — a replaced instrument cluster, a typo being
     * corrected — and then it must be deliberate and explained rather than
     * silently accepted, because mileage drives maintenance triggers.
     */
    isCorrection: z.boolean().default(false),
  })
  .refine((value) => !value.isCorrection || (value.note && value.note.length > 0), {
    message: 'A correction needs a note explaining it',
    path: ['note'],
  });
export type RecordMileageRequest = z.infer<typeof recordMileageRequestSchema>;

export const mileageHistoryResponseSchema = paginated(mileageReadingSchema);
export type MileageHistoryResponse = z.infer<typeof mileageHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Overview — VEH-02
// ---------------------------------------------------------------------------

const overviewAssignmentSchema = z.object({
  id: uuidSchema,
  driverId: uuidSchema,
  driverName: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
});

const overviewMaintenanceSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(MAINTENANCE_STATUSES),
  dueDate: z.string().nullable(),
  dueMileage: z.number().int().nullable(),
  completedAt: z.string().nullable(),
  costTotal: z.string(),
  currency: z.string(),
  mechanicName: z.string().nullable(),
});

const overviewDocumentSchema = z.object({
  id: uuidSchema,
  typeLabel: z.string(),
  referenceNo: z.string().nullable(),
  expiryDate: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  daysUntilExpiry: z.number().int(),
});

/**
 * The four sections VEH-02 requires, in one response.
 *
 * Acceptance: "The detail page loads all four aggregate sections without a
 * separate navigation step." One request rather than four also means the tabs
 * cannot show data from four different moments.
 */
export const vehicleOverviewSchema = z.object({
  vehicle: vehicleSchema,
  driverHistory: z.array(overviewAssignmentSchema),
  upcomingMaintenance: z.array(overviewMaintenanceSchema),
  maintenanceHistory: z.array(overviewMaintenanceSchema),
  documents: z.array(overviewDocumentSchema),
  recentMileage: z.array(mileageReadingSchema),
  totals: z.object({
    maintenanceCost: z.string(),
    completedJobs: z.number().int(),
    openJobs: z.number().int(),
    expiringDocuments: z.number().int(),
    openDamages: z.number().int(),
  }),
});
export type VehicleOverview = z.infer<typeof vehicleOverviewSchema>;
