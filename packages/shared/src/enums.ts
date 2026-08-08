/**
 * Domain enums.
 *
 * These are the canonical spelling of every enumerated value in FleetFlow.
 * The Prisma schema (FF-103) mirrors them exactly, so a value can never mean
 * one thing in the database and another in the UI.
 *
 * Each is declared as a `const` array first and its type derived from it, so
 * the same declaration serves runtime iteration (dropdowns, generated tests)
 * and compile-time narrowing.
 */

/** Helper: build a Zod-friendly, iterable enum from a const tuple. */
type ValuesOf<T extends readonly string[]> = T[number];

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** PRD §2 — the five roles. Order is the permission hierarchy, loosest last. */
export const USER_ROLES = ['ADMIN', 'FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'] as const;
export type UserRole = ValuesOf<typeof USER_ROLES>;

export const DRIVER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type DriverStatus = ValuesOf<typeof DRIVER_STATUSES>;

// ---------------------------------------------------------------------------
// Vehicles — VEH-06
// ---------------------------------------------------------------------------

export const VEHICLE_STATUSES = ['ACTIVE', 'UNDER_MAINTENANCE', 'ARCHIVED'] as const;
export type VehicleStatus = ValuesOf<typeof VEHICLE_STATUSES>;

export const MILEAGE_SOURCES = ['MANUAL', 'MAINTENANCE'] as const;
export type MileageSource = ValuesOf<typeof MILEAGE_SOURCES>;

// ---------------------------------------------------------------------------
// Maintenance — MNT-02, MNT-06
// ---------------------------------------------------------------------------

export const MAINTENANCE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'] as const;
export type MaintenanceStatus = ValuesOf<typeof MAINTENANCE_STATUSES>;

export const MAINTENANCE_KINDS = ['SCHEDULED', 'UNEXPECTED'] as const;
export type MaintenanceKind = ValuesOf<typeof MAINTENANCE_KINDS>;

export const TRIGGER_TYPES = ['DATE', 'MILEAGE', 'BOTH'] as const;
export type TriggerType = ValuesOf<typeof TRIGGER_TYPES>;

/**
 * Legal status transitions (MNT-06).
 *
 * OVERDUE is not a manual destination — only the trigger engine (FF-503) sets
 * it, by observing a passed due date or mileage. It is reachable from PLANNED
 * and IN_PROGRESS, and an overdue task can still be started or completed late.
 * COMPLETED is terminal: correcting a mistaken completion is an edit of the
 * record, not a status transition, so the completion history stays honest.
 */
export const MAINTENANCE_TRANSITIONS: Readonly<
  Record<MaintenanceStatus, readonly MaintenanceStatus[]>
> = {
  PLANNED: ['IN_PROGRESS', 'COMPLETED', 'OVERDUE'],
  IN_PROGRESS: ['COMPLETED', 'OVERDUE'],
  OVERDUE: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
} as const;

export function canTransitionMaintenance(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  return MAINTENANCE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Documents — DOC-05
// ---------------------------------------------------------------------------

/**
 * Derived, never stored. Computed in SQL from expiry_date and notice_days so
 * the value cannot go stale when the clock passes midnight with no write.
 */
export const DOCUMENT_STATUSES = ['VALID', 'EXPIRING_SOON', 'EXPIRED'] as const;
export type DocumentStatus = ValuesOf<typeof DOCUMENT_STATUSES>;

// ---------------------------------------------------------------------------
// Damages — DMG
// ---------------------------------------------------------------------------

export const DAMAGE_STATUSES = [
  'REPORTED',
  'UNDER_REVIEW',
  'LINKED',
  'RESOLVED',
  'REJECTED',
] as const;
export type DamageStatus = ValuesOf<typeof DAMAGE_STATUSES>;

export const DAMAGE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type DamageSeverity = ValuesOf<typeof DAMAGE_SEVERITIES>;

// ---------------------------------------------------------------------------
// Attachments — DOC-02, MNT-03, DMG-04
// ---------------------------------------------------------------------------

export const ATTACHMENT_ENTITIES = ['DOCUMENT', 'MAINTENANCE_OP', 'DAMAGE'] as const;
export type AttachmentEntity = ValuesOf<typeof ATTACHMENT_ENTITIES>;

export const ATTACHMENT_KINDS = ['SCAN', 'INVOICE', 'PHOTO'] as const;
export type AttachmentKind = ValuesOf<typeof ATTACHMENT_KINDS>;

/**
 * PENDING is written when the signed upload URL is issued; READY only after the
 * API has verified the stored object's real size and content type. Nothing
 * outside the upload flow should ever read a PENDING attachment.
 */
export const UPLOAD_STATES = ['PENDING', 'READY'] as const;
export type UploadState = ValuesOf<typeof UPLOAD_STATES>;

// ---------------------------------------------------------------------------
// Notifications — NTF-01…04
// ---------------------------------------------------------------------------

export const NOTIFICATION_RULES = [
  'MAINTENANCE_UPCOMING',
  'DOCUMENT_EXPIRING',
  'INSPECTION_DUE',
  'MAINTENANCE_OVERDUE',
] as const;
export type NotificationRule = ValuesOf<typeof NOTIFICATION_RULES>;

export const DELIVERY_CHANNELS = ['EMAIL'] as const;
export type DeliveryChannel = ValuesOf<typeof DELIVERY_CHANNELS>;

export const DELIVERY_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;
export type DeliveryStatus = ValuesOf<typeof DELIVERY_STATUSES>;

// ---------------------------------------------------------------------------
// Reports — RPT-01…06
// ---------------------------------------------------------------------------

export const REPORT_NAMES = [
  'maintenance-history',
  'cost-by-vehicle',
  'cost-by-period',
  'driver-assignments',
  'expiring-documents',
] as const;
export type ReportName = ValuesOf<typeof REPORT_NAMES>;

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = ValuesOf<typeof EXPORT_FORMATS>;
