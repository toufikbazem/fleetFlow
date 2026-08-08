/**
 * The permission matrix — PRD §2.1, expressed as data.
 *
 * This file is the single authority on who may do what. The API enforces it in
 * `authorize()` middleware and in repository scope resolvers (FF-206); the web
 * app reads the same object to decide which navigation entries and buttons to
 * render (FF-1101). Because both sides consult one table, the UI can never
 * offer an action the API will refuse — and it can never quietly permit one
 * either. **The UI mirrors access; it never decides it.**
 *
 * FF-207 iterates MODULES × USER_ROLES × ACTIONS over this table to generate an
 * exhaustive authorisation test — 140 assertions from one declaration.
 */

import { USER_ROLES, type UserRole } from './enums.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const MODULES = [
  'vehicles',
  'drivers',
  'maintenance',
  'documents',
  'damages',
  'reports',
  'users',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Grant codes, using the PRD's own legend plus the scope it left implicit.
 *
 *   F           full — create, read, update, delete, across all records
 *   R           read, across all records
 *   -           no access
 *   R_OWN       read, limited to the vehicle currently assigned to this driver
 *   R_SELF      read, limited to this user's own driver record
 *   W_ASSIGNED  read and update, limited to records assigned to this user
 *   W_REPORT    create and read, limited to the driver's own vehicle
 */
export type Grant = 'F' | 'R' | '-' | 'R_OWN' | 'R_SELF' | 'W_ASSIGNED' | 'W_REPORT';

/**
 * How far a granted action reaches. Every repository read for a scoped role
 * receives a mandatory `where` fragment derived from this — scoping lives in
 * the repository layer, not the route, so a new endpoint cannot forget it.
 */
export type Scope =
  | 'all'
  /** Records belonging to the vehicle currently assigned to this driver. */
  | 'own_vehicle'
  /** The driver record linked to this user account. */
  | 'self'
  /** Records where this user is the assigned mechanic. */
  | 'assigned';

// ---------------------------------------------------------------------------
// The matrix — PRD §2.1, confirmed by the client
// ---------------------------------------------------------------------------

export const MATRIX: Readonly<Record<Module, Readonly<Record<UserRole, Grant>>>> = {
  vehicles: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: 'R',
    ACCOUNTANT: 'R',
    DRIVER: 'R_OWN',
  },
  drivers: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: '-',
    ACCOUNTANT: 'R',
    DRIVER: 'R_SELF',
  },
  maintenance: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: 'W_ASSIGNED',
    ACCOUNTANT: 'R',
    DRIVER: 'R_OWN',
  },
  documents: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: 'R',
    ACCOUNTANT: 'R',
    DRIVER: 'R_OWN',
  },
  damages: {
    ADMIN: 'F',
    FLEET_MANAGER: 'F',
    MECHANIC: 'R',
    ACCOUNTANT: 'R',
    DRIVER: 'W_REPORT',
  },
  reports: {
    ADMIN: 'F',
    FLEET_MANAGER: 'R',
    MECHANIC: '-',
    ACCOUNTANT: 'R',
    DRIVER: '-',
  },
  users: {
    ADMIN: 'F',
    FLEET_MANAGER: '-',
    MECHANIC: '-',
    ACCOUNTANT: '-',
    DRIVER: '-',
  },
} as const;

// ---------------------------------------------------------------------------
// Grant semantics
// ---------------------------------------------------------------------------

interface GrantSpec {
  readonly actions: readonly Action[];
  readonly scope: Scope;
}

const GRANT_SPECS: Readonly<Record<Grant, GrantSpec>> = {
  F: { actions: ['create', 'read', 'update', 'delete'], scope: 'all' },
  R: { actions: ['read'], scope: 'all' },
  '-': { actions: [], scope: 'all' },
  R_OWN: { actions: ['read'], scope: 'own_vehicle' },
  R_SELF: { actions: ['read'], scope: 'self' },
  W_ASSIGNED: { actions: ['read', 'update'], scope: 'assigned' },
  // A driver may file a report and see reports on the vehicle they drive, but
  // may not edit or withdraw one once filed — the fleet manager's queue must
  // not be able to change under them (DMG-03).
  W_REPORT: { actions: ['create', 'read'], scope: 'own_vehicle' },
} as const;

export interface PermissionDecision {
  readonly allowed: boolean;
  /** Only meaningful when `allowed` is true. */
  readonly scope: Scope;
}

const DENIED: PermissionDecision = { allowed: false, scope: 'all' } as const;

/**
 * The authorisation primitive. Returns both the verdict and the row scope the
 * caller must apply — a caller that ignores `scope` on an `own_vehicle` grant
 * has an IDOR bug, which is why repositories take the scope, not the route.
 */
export function can(role: UserRole, module: Module, action: Action): PermissionDecision {
  const grant = MATRIX[module][role];
  const spec = GRANT_SPECS[grant];
  if (!spec.actions.includes(action)) {
    return DENIED;
  }
  return { allowed: true, scope: spec.scope };
}

/** Convenience for call sites that only need the verdict. */
export function isAllowed(role: UserRole, module: Module, action: Action): boolean {
  return can(role, module, action).allowed;
}

/** Modules this role may see at all — drives the sidebar and route guards. */
export function visibleModules(role: UserRole): Module[] {
  return MODULES.filter((module) => isAllowed(role, module, 'read'));
}

/** Actions this role may perform on a module — drives button visibility. */
export function allowedActions(role: UserRole, module: Module): Action[] {
  return GRANT_SPECS[MATRIX[module][role]].actions.filter(
    // Re-checked through `can` so this helper can never drift from the primitive.
    (action) => isAllowed(role, module, action),
  );
}

/** Every (role, module, action) triple — the input to FF-207's generated test. */
export function enumeratePermissions(): Array<{
  role: UserRole;
  module: Module;
  action: Action;
  decision: PermissionDecision;
}> {
  return USER_ROLES.flatMap((role) =>
    MODULES.flatMap((module) =>
      ACTIONS.map((action) => ({ role, module, action, decision: can(role, module, action) })),
    ),
  );
}
