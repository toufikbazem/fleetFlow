import { describe, expect, it } from 'vitest';
import { USER_ROLES, type UserRole } from './enums.js';
import {
  ACTIONS,
  MATRIX,
  MODULES,
  allowedActions,
  can,
  enumeratePermissions,
  isAllowed,
  visibleModules,
  type Module,
} from './permissions.js';

describe('matrix completeness', () => {
  it('declares a grant for every module and role', () => {
    for (const module of MODULES) {
      for (const role of USER_ROLES) {
        expect(MATRIX[module][role], `${module}/${role}`).toBeDefined();
      }
    }
  });

  it('enumerates 7 modules x 5 roles x 4 actions', () => {
    expect(enumeratePermissions()).toHaveLength(
      MODULES.length * USER_ROLES.length * ACTIONS.length,
    );
    expect(enumeratePermissions()).toHaveLength(140);
  });
});

describe('PRD §2.1 parity', () => {
  // Transcribed from the PRD table rather than derived from MATRIX, so a typo
  // in the matrix cannot silently satisfy its own test.
  const PRD_TABLE: Record<Module, Record<UserRole, string>> = {
    vehicles: {
      ADMIN: 'F',
      FLEET_MANAGER: 'F',
      MECHANIC: 'R',
      ACCOUNTANT: 'R',
      DRIVER: 'R (own only)',
    },
    drivers: { ADMIN: 'F', FLEET_MANAGER: 'F', MECHANIC: '—', ACCOUNTANT: 'R', DRIVER: 'R (self)' },
    maintenance: {
      ADMIN: 'F',
      FLEET_MANAGER: 'F',
      MECHANIC: 'W (assigned tasks)',
      ACCOUNTANT: 'R',
      DRIVER: 'R (own vehicle)',
    },
    documents: {
      ADMIN: 'F',
      FLEET_MANAGER: 'F',
      MECHANIC: 'R',
      ACCOUNTANT: 'R',
      DRIVER: 'R (own vehicle)',
    },
    damages: {
      ADMIN: 'F',
      FLEET_MANAGER: 'F',
      MECHANIC: 'R',
      ACCOUNTANT: 'R',
      DRIVER: 'W (report only)',
    },
    reports: { ADMIN: 'F', FLEET_MANAGER: 'R', MECHANIC: '—', ACCOUNTANT: 'R', DRIVER: '—' },
    users: { ADMIN: 'F', FLEET_MANAGER: '—', MECHANIC: '—', ACCOUNTANT: '—', DRIVER: '—' },
  };

  const EXPECTED: Record<string, { read: boolean; write: boolean }> = {
    F: { read: true, write: true },
    R: { read: true, write: false },
    '—': { read: false, write: false },
    'R (own only)': { read: true, write: false },
    'R (self)': { read: true, write: false },
    'R (own vehicle)': { read: true, write: false },
    'W (assigned tasks)': { read: true, write: true },
    'W (report only)': { read: true, write: true },
  };

  it.each(MODULES)('%s matches the PRD row', (module) => {
    for (const role of USER_ROLES) {
      const cell = PRD_TABLE[module][role];
      const expected = EXPECTED[cell];
      expect(expected, `unmapped PRD cell "${cell}"`).toBeDefined();

      expect(isAllowed(role, module, 'read'), `${module}/${role} read`).toBe(expected?.read);

      const writes = ACTIONS.filter((a) => a !== 'read').some((a) => isAllowed(role, module, a));
      expect(writes, `${module}/${role} write`).toBe(expected?.write);
    }
  });
});

describe('admin', () => {
  it('has full access to every module', () => {
    for (const module of MODULES) {
      for (const action of ACTIONS) {
        expect(can('ADMIN', module, action)).toEqual({ allowed: true, scope: 'all' });
      }
    }
  });
});

describe('scoped grants', () => {
  it('limits a driver to their own vehicle on vehicles, maintenance and documents', () => {
    for (const module of ['vehicles', 'maintenance', 'documents'] as const) {
      expect(can('DRIVER', module, 'read')).toEqual({ allowed: true, scope: 'own_vehicle' });
    }
  });

  it('limits a driver to their own record on drivers', () => {
    expect(can('DRIVER', 'drivers', 'read')).toEqual({ allowed: true, scope: 'self' });
  });

  it('lets a driver file a damage report but never edit or delete one', () => {
    expect(can('DRIVER', 'damages', 'create')).toEqual({ allowed: true, scope: 'own_vehicle' });
    expect(can('DRIVER', 'damages', 'read')).toEqual({ allowed: true, scope: 'own_vehicle' });
    expect(isAllowed('DRIVER', 'damages', 'update')).toBe(false);
    expect(isAllowed('DRIVER', 'damages', 'delete')).toBe(false);
  });

  it('lets a mechanic update assigned maintenance but not create or delete it', () => {
    expect(can('MECHANIC', 'maintenance', 'update')).toEqual({ allowed: true, scope: 'assigned' });
    expect(isAllowed('MECHANIC', 'maintenance', 'create')).toBe(false);
    expect(isAllowed('MECHANIC', 'maintenance', 'delete')).toBe(false);
  });
});

describe('read-only roles never gain a write verb', () => {
  it('accountant cannot write anywhere', () => {
    for (const module of MODULES) {
      for (const action of ['create', 'update', 'delete'] as const) {
        expect(isAllowed('ACCOUNTANT', module, action), `${module}/${action}`).toBe(false);
      }
    }
  });
});

describe('user management is admin-only', () => {
  it.each(USER_ROLES.filter((r) => r !== 'ADMIN'))('%s has no access to users', (role) => {
    for (const action of ACTIONS) {
      expect(isAllowed(role, 'users', action)).toBe(false);
    }
  });
});

describe('mechanic has no access to drivers or reports', () => {
  it.each(['drivers', 'reports'] as const)('%s is closed to MECHANIC', (module) => {
    for (const action of ACTIONS) {
      expect(isAllowed('MECHANIC', module, action)).toBe(false);
    }
  });
});

describe('UI helpers agree with the primitive', () => {
  it('visibleModules returns exactly the readable modules', () => {
    expect(visibleModules('DRIVER')).toEqual([
      'vehicles',
      'drivers',
      'maintenance',
      'documents',
      'damages',
    ]);
    expect(visibleModules('MECHANIC')).toEqual(['vehicles', 'maintenance', 'documents', 'damages']);
    expect(visibleModules('ADMIN')).toEqual([...MODULES]);
  });

  it('allowedActions never exceeds can()', () => {
    for (const role of USER_ROLES) {
      for (const module of MODULES) {
        for (const action of allowedActions(role, module)) {
          expect(isAllowed(role, module, action), `${role}/${module}/${action}`).toBe(true);
        }
      }
    }
  });
});
