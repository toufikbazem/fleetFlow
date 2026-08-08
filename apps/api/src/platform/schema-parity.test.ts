/**
 * Enum parity between the database and the shared contract — FF-103.
 *
 * The Prisma schema and packages/shared/src/enums.ts declare the same value
 * sets twice, in two languages. Nothing in either file prevents them drifting:
 * adding a maintenance status to one and forgetting the other produces a
 * runtime failure at the boundary — a value the API can persist but the UI
 * cannot label, or vice versa.
 *
 * These tests make that drift a build failure instead.
 */

import { $Enums } from '@prisma/client';
import {
  ATTACHMENT_ENTITIES,
  ATTACHMENT_KINDS,
  DAMAGE_SEVERITIES,
  DAMAGE_STATUSES,
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  DRIVER_STATUSES,
  MAINTENANCE_KINDS,
  MAINTENANCE_STATUSES,
  MILEAGE_SOURCES,
  NOTIFICATION_RULES,
  TRIGGER_TYPES,
  UPLOAD_STATES,
  USER_ROLES,
  VEHICLE_STATUSES,
} from '@fleetflow/shared';
import { describe, expect, it } from 'vitest';

/** Prisma emits each enum as a frozen object; its values are the DB labels. */
function prismaValues(enumObject: Record<string, string>): string[] {
  return Object.values(enumObject).sort();
}

function sharedValues(values: readonly string[]): string[] {
  return [...values].sort();
}

const PAIRS: Array<[name: string, prisma: Record<string, string>, shared: readonly string[]]> = [
  ['UserRole', $Enums.UserRole, USER_ROLES],
  ['DriverStatus', $Enums.DriverStatus, DRIVER_STATUSES],
  ['VehicleStatus', $Enums.VehicleStatus, VEHICLE_STATUSES],
  ['MileageSource', $Enums.MileageSource, MILEAGE_SOURCES],
  ['MaintenanceStatus', $Enums.MaintenanceStatus, MAINTENANCE_STATUSES],
  ['MaintenanceKind', $Enums.MaintenanceKind, MAINTENANCE_KINDS],
  ['TriggerType', $Enums.TriggerType, TRIGGER_TYPES],
  ['DamageStatus', $Enums.DamageStatus, DAMAGE_STATUSES],
  ['DamageSeverity', $Enums.DamageSeverity, DAMAGE_SEVERITIES],
  ['AttachmentEntity', $Enums.AttachmentEntity, ATTACHMENT_ENTITIES],
  ['AttachmentKind', $Enums.AttachmentKind, ATTACHMENT_KINDS],
  ['UploadState', $Enums.UploadState, UPLOAD_STATES],
  ['NotificationRule', $Enums.NotificationRule, NOTIFICATION_RULES],
  ['DeliveryChannel', $Enums.DeliveryChannel, DELIVERY_CHANNELS],
  ['DeliveryStatus', $Enums.DeliveryStatus, DELIVERY_STATUSES],
];

describe('database enums match the shared contract', () => {
  it.each(PAIRS)('%s', (_name, prisma, shared) => {
    expect(prismaValues(prisma)).toEqual(sharedValues(shared));
  });

  it('covers every enum Prisma generates', () => {
    // Guards the guard: a new enum added to schema.prisma but not to PAIRS
    // would otherwise be silently unchecked.
    const generated = Object.keys($Enums).sort();
    const covered = PAIRS.map(([name]) => name).sort();
    expect(generated).toEqual(covered);
  });
});

describe('DocumentStatus is deliberately absent from the database', () => {
  it('is not a Prisma enum, because DOC-05 status is derived in SQL', () => {
    // A stored status goes stale the moment the clock passes midnight with no
    // write to the row. If this test starts failing, someone has added a
    // document status column — check that decision before deleting the test.
    expect(Object.keys($Enums)).not.toContain('DocumentStatus');
  });
});
