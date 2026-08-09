/**
 * Row scoping — FF-206.
 *
 * The permission matrix answers "may this role read maintenance?". It does not
 * answer "*which* maintenance?", and that second question is where the
 * dangerous bugs live: a Driver correctly allowed to read maintenance, then
 * handed every vehicle's maintenance, is a data breach that no status-code test
 * would catch.
 *
 * So `can()` returns a scope alongside its verdict, and this module turns that
 * scope into a Prisma `where` fragment. Repositories take the fragment as a
 * mandatory argument; scoping therefore lives one layer below the route, and a
 * new endpoint cannot forget to apply it.
 *
 * **Everything here fails closed.** An unresolvable scope — a Driver-role
 * account with no linked driver record, a driver with no current assignment —
 * yields a filter that matches nothing, never one that matches everything.
 */

import type { Scope, UserRole } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';

/**
 * Who the caller is, without a scope attached.
 *
 * Used by the polymorphic attachment endpoints: the module that governs an
 * upload depends on what it is attached to, so no single `authorize()` call can
 * resolve a scope before the handler runs. Those services take an identity and
 * resolve the scope per entity — carrying a placeholder scope around instead
 * would be a lie the type system could not catch.
 */
export interface CallerIdentity {
  role: UserRole;
  userId: string;
  /** Set only when the account is linked to a driver record (DRV-04). */
  driverId: string | null;
}

/** The caller, resolved by `authorize()` and consumed by repositories. */
export interface CallerScope extends CallerIdentity {
  scope: Scope;
}

/**
 * An `in` against an empty list. Postgres resolves it to false for every row,
 * so it is a filter that matches nothing — the safe direction when a scope
 * cannot be resolved.
 */
const NONE: { in: string[] } = { in: [] };

/**
 * Vehicles this driver currently holds.
 *
 * Q5 permits one *driver* per vehicle, not one vehicle per driver, so this is
 * legitimately a list. Only open assignments count: a vehicle handed back last
 * month is history (DRV-03) and must not still be readable.
 */
export async function currentVehicleIds(driverId: string): Promise<string[]> {
  const assignments = await prisma.assignment.findMany({
    where: { driverId, endDate: null },
    select: { vehicleId: true },
  });
  return assignments.map((assignment) => assignment.vehicleId);
}

async function scopedVehicleIds(caller: CallerScope): Promise<{ in: string[] }> {
  // A DRIVER-role account with no driver record has no vehicles — not all of them.
  if (!caller.driverId) return NONE;
  return { in: await currentVehicleIds(caller.driverId) };
}

// ---------------------------------------------------------------------------
// Per-module filters
// ---------------------------------------------------------------------------

export async function vehicleScope(caller: CallerScope): Promise<Prisma.VehicleWhereInput> {
  switch (caller.scope) {
    case 'all':
      return {};
    case 'own_vehicle':
      return { id: await scopedVehicleIds(caller) };
    case 'self':
    case 'assigned':
      // Neither scope has a meaning for vehicles. Deny rather than guess.
      return { id: NONE };
  }
}

export async function driverScope(caller: CallerScope): Promise<Prisma.DriverWhereInput> {
  switch (caller.scope) {
    case 'all':
      return {};
    case 'self':
      return { id: caller.driverId ? { in: [caller.driverId] } : NONE };
    case 'own_vehicle':
    case 'assigned':
      return { id: NONE };
  }
}

export async function maintenanceScope(
  caller: CallerScope,
): Promise<Prisma.MaintenanceOpWhereInput> {
  switch (caller.scope) {
    case 'all':
      return {};
    case 'own_vehicle':
      return { vehicleId: await scopedVehicleIds(caller) };
    case 'assigned':
      // A mechanic sees the tasks assigned to them, on any vehicle (MNT-07).
      return { mechanicId: caller.userId };
    case 'self':
      return { id: NONE };
  }
}

export async function documentScope(caller: CallerScope): Promise<Prisma.DocumentWhereInput> {
  switch (caller.scope) {
    case 'all':
      return {};
    case 'own_vehicle':
      return { vehicleId: await scopedVehicleIds(caller) };
    case 'self':
    case 'assigned':
      return { id: NONE };
  }
}

export async function damageScope(caller: CallerScope): Promise<Prisma.DamageWhereInput> {
  switch (caller.scope) {
    case 'all':
      return {};
    case 'own_vehicle':
      return { vehicleId: await scopedVehicleIds(caller) };
    case 'self':
    case 'assigned':
      return { id: NONE };
  }
}

// ---------------------------------------------------------------------------
// The same filters, as SQL
// ---------------------------------------------------------------------------

/**
 * Scope for a raw query, keyed by a vehicle column.
 *
 * Some predicates compare a column against another table's column — a
 * maintenance op's `due_mileage` against its vehicle's `current_mileage`, a
 * document's expiry against its type's notice period — and Prisma cannot express
 * those. Those queries are raw, and they still need scoping, so the same
 * decisions are mirrored here.
 *
 * **`= ANY(…::uuid[])`, not `IN (…)`.** Prisma binds parameters as text and
 * Postgres has no `uuid = text` operator, so an uncast list fails at runtime
 * with 42883 — and only for the scoped roles, which are exactly the ones a
 * manual test as an administrator never exercises.
 *
 * Fails closed in the same direction as the Prisma filters: an unresolvable
 * scope yields `FALSE`, never `TRUE`.
 */
export async function vehicleScopeSql(
  caller: CallerScope,
  column: Prisma.Sql,
): Promise<Prisma.Sql> {
  switch (caller.scope) {
    case 'all':
      return Prisma.sql`TRUE`;
    case 'own_vehicle': {
      if (!caller.driverId) return Prisma.sql`FALSE`;
      const ids = await currentVehicleIds(caller.driverId);
      // ANY over an empty array is false for every row, but being explicit
      // keeps the intent readable at the call site.
      if (ids.length === 0) return Prisma.sql`FALSE`;
      return Prisma.sql`${column} = ANY(${ids}::uuid[])`;
    }
    case 'assigned':
    case 'self':
      // Neither scope names a set of vehicles. Deny rather than guess.
      return Prisma.sql`FALSE`;
  }
}

/**
 * Scope for raw maintenance queries.
 *
 * A mechanic's scope is by assignment (MNT-07), not by vehicle, so it cannot go
 * through `vehicleScopeSql` — the same split the Prisma `maintenanceScope`
 * makes.
 */
export async function maintenanceScopeSql(caller: CallerScope): Promise<Prisma.Sql> {
  if (caller.scope === 'assigned') {
    return Prisma.sql`m.mechanic_id = ${caller.userId}::uuid`;
  }
  return vehicleScopeSql(caller, Prisma.sql`m.vehicle_id`);
}

/**
 * True when the caller may act on this specific vehicle.
 *
 * For write paths, where a `where` fragment is not enough: creating a damage
 * report names its vehicle in the body, and DMG-03 limits a driver to the one
 * they are actually assigned to.
 */
export async function canReachVehicle(caller: CallerScope, vehicleId: string): Promise<boolean> {
  if (caller.scope === 'all') return true;
  if (caller.scope !== 'own_vehicle' || !caller.driverId) return false;
  return (await currentVehicleIds(caller.driverId)).includes(vehicleId);
}
