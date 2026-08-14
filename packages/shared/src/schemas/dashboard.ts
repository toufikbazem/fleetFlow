/**
 * Dashboard contract — DSH-01…08.
 *
 * **Why every counter carries its own filter.**
 *
 * The acceptance criterion is "every counter is clickable and drills through to
 * the corresponding filtered list". The trap is that the count is computed by
 * one piece of code and the link by another: the server counts overdue work with
 * its definition of overdue, the client links to `?status=OVERDUE`, and the two
 * quietly disagree — a dashboard reading 7 that opens onto a list of 5. Nobody
 * files that as a bug; they just stop trusting the number.
 *
 * So the server emits the exact query parameters that reproduce what it counted,
 * next to the count itself. The client owns only the route path. The count and
 * its drill-through therefore come from one source and cannot drift.
 *
 * **Why sections are nullable rather than absent.** A Mechanic gets no cost
 * summary; a Driver gets no fleet totals. Modelling that as `null` keeps one
 * response shape for all five roles, so the client renders what it was given
 * instead of testing the caller's role a second time and reaching a different
 * conclusion from the server.
 */

import { z } from 'zod';
import { DOCUMENT_STATUSES, MAINTENANCE_STATUSES } from '../enums.js';
import { notificationSchema } from './notifications.js';
import { uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** A number and the query that reproduces the rows behind it. */
export const dashboardCounterSchema = z.object({
  value: z.number().int(),
  /**
   * Query parameters for the matching list endpoint. String-valued because that
   * is what a URL carries; the list schemas coerce them back.
   */
  filter: z.record(z.string(), z.string()),
});
export type DashboardCounter = z.infer<typeof dashboardCounterSchema>;

// ---------------------------------------------------------------------------
// DSH-01…03 — vehicles
// ---------------------------------------------------------------------------

export const dashboardVehiclesSchema = z.object({
  /** DSH-01. Excludes archived: a disposed vehicle is not part of the fleet you run. */
  total: dashboardCounterSchema,
  /** DSH-02 */
  active: dashboardCounterSchema,
  /** DSH-03 */
  underMaintenance: dashboardCounterSchema,
});
export type DashboardVehicles = z.infer<typeof dashboardVehiclesSchema>;

// ---------------------------------------------------------------------------
// DSH-04, DSH-05 — maintenance
// ---------------------------------------------------------------------------

export const dashboardMaintenanceItemSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  title: z.string(),
  status: z.enum(MAINTENANCE_STATUSES),
  dueDate: z.string().nullable(),
  dueMileage: z.number().int().nullable(),
  currentMileage: z.number().int(),
  /** Negative once the date has passed. Null for mileage-only work. */
  daysUntilDue: z.number().int().nullable(),
});
export type DashboardMaintenanceItem = z.infer<typeof dashboardMaintenanceItemSchema>;

export const dashboardMaintenanceSchema = z.object({
  /** DSH-04 */
  upcoming: dashboardCounterSchema,
  /** DSH-05 */
  overdue: dashboardCounterSchema,
  /** The soonest few of both, so the widget says *what* rather than only *how many*. */
  preview: z.array(dashboardMaintenanceItemSchema),
  /** The notice window the upcoming count used, in days — shown so the number is legible. */
  noticeDays: z.number().int(),
});
export type DashboardMaintenance = z.infer<typeof dashboardMaintenanceSchema>;

// ---------------------------------------------------------------------------
// DSH-06 — documents
// ---------------------------------------------------------------------------

export const dashboardDocumentItemSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  typeLabel: z.string(),
  expiryDate: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  daysUntilExpiry: z.number().int(),
});
export type DashboardDocumentItem = z.infer<typeof dashboardDocumentItemSchema>;

export const dashboardDocumentsSchema = z.object({
  /** DSH-06 — inside the notice window but still valid. */
  expiring: dashboardCounterSchema,
  /**
   * Already lapsed.
   *
   * Not named in the PRD's eight widgets, and included deliberately: a document
   * that expired yesterday leaves the "expiring soon" bucket, so a dashboard
   * showing only DSH-06 would make the most serious case the only invisible one.
   */
  expired: dashboardCounterSchema,
  preview: z.array(dashboardDocumentItemSchema),
});
export type DashboardDocuments = z.infer<typeof dashboardDocumentsSchema>;

// ---------------------------------------------------------------------------
// DSH-08 — monthly maintenance cost
// ---------------------------------------------------------------------------

export const dashboardCostMonthSchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  total: z.number(),
  operations: z.number().int(),
});
export type DashboardCostMonth = z.infer<typeof dashboardCostMonthSchema>;

export const dashboardCostSchema = z.object({
  currency: z.string(),
  /** Twelve entries, oldest first, zero-filled — a gap in a chart reads as missing data. */
  months: z.array(dashboardCostMonthSchema),
  /** Sum across the window, so the client never re-adds and gets a different figure. */
  total: z.number(),
  /** The current calendar month, for the headline figure. */
  currentMonthTotal: z.number(),
});
export type DashboardCost = z.infer<typeof dashboardCostSchema>;

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

export const dashboardSchema = z.object({
  generatedAt: z.string(),
  /** True when this response came from Redis rather than Postgres (DSH acceptance). */
  cached: z.boolean(),
  /** DSH-01…03 — null when the caller cannot read vehicles. */
  vehicles: dashboardVehiclesSchema.nullable(),
  /** DSH-04, DSH-05 */
  maintenance: dashboardMaintenanceSchema.nullable(),
  /** DSH-06 */
  documents: dashboardDocumentsSchema.nullable(),
  /** DSH-07 — always present; a notification is addressed to a person. */
  recentNotifications: z.array(notificationSchema),
  /** DSH-08 — null unless the caller may read reports. Fleet spend is not for everyone. */
  cost: dashboardCostSchema.nullable(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
