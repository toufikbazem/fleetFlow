/**
 * Generated authorisation matrix — FF-207.
 *
 * 7 modules × 5 roles × 4 verbs = 140 assertions, produced from one table
 * rather than written by hand. Hand-written authorisation tests cover the cases
 * someone thought of; this covers every cell, including the ones nobody would
 * think to check.
 *
 * **What each layer proves.**
 *
 *   permissions.test.ts (unit)  MATRIX matches the PRD §2.1 table, transcribed
 *                               by hand so a typo cannot satisfy its own test.
 *   this file (integration)     the HTTP layer enforces exactly that table —
 *                               real tokens, real middleware, real status codes.
 *
 * Together: the PRD is the oracle, and the API is measured against it.
 *
 * The routes below are probes. Real module endpoints (FF-301 onward) mount the
 * same `authorize()` middleware, so what is verified here is the guard itself.
 * Per-endpoint coverage arrives with each module and again in FF-1201.
 */

import {
  ACTIONS,
  MODULES,
  USER_ROLES,
  can,
  type Action,
  type Module,
  type UserRole,
} from '@fleetflow/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { disconnectDb } from '../db.js';
import { resetRateLimits } from '../rate-limit.js';
import { connectRedis, disconnectRedis } from '../redis.js';
import { authorize, callerScope } from './authorize.js';
import { requireAuth } from './require-auth.js';

let app: Express;
const tokens = new Map<UserRole, string>();

/** Seeded accounts, one per role. */
const ACCOUNTS: Record<UserRole, string> = {
  ADMIN: 'admin@fleetflow.local',
  FLEET_MANAGER: 'manager@fleetflow.local',
  MECHANIC: 'mechanic@fleetflow.local',
  ACCOUNTANT: 'accountant@fleetflow.local',
  DRIVER: 'amina@fleetflow.local',
};
const PASSWORD = 'FleetFlow-Dev-2026!';

function probePath(module: Module, action: Action): string {
  return `/__authz/${module}/${action}`;
}

beforeAll(async () => {
  await connectRedis();
  // Signs in as all five roles; AUTH-05's per-IP counter is shared with every
  // other suite running against the same Redis.
  await resetRateLimits();

  app = createApp({
    configure: (instance) => {
      // One probe per cell. Every probe is wired exactly as a real endpoint
      // will be: requireAuth, then authorize, then the handler.
      for (const module of MODULES) {
        for (const action of ACTIONS) {
          instance.get(
            probePath(module, action),
            requireAuth,
            authorize(module, action),
            (req, res) => {
              res.json({ scope: callerScope(req).scope });
            },
          );
        }
      }
    },
  });

  for (const role of USER_ROLES) {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTS[role], password: PASSWORD });

    if (response.status !== 200) {
      throw new Error(`Could not sign in as ${role}: ${response.status}`);
    }
    expect(response.body.user.role).toBe(role);
    tokens.set(role, response.body.accessToken as string);
  }
});

afterAll(async () => {
  await Promise.allSettled([disconnectDb(), disconnectRedis()]);
});

function tokenFor(role: UserRole): string {
  const token = tokens.get(role);
  if (!token) throw new Error(`No token for ${role}`);
  return token;
}

// ---------------------------------------------------------------------------
// The generated matrix
// ---------------------------------------------------------------------------

const CELLS = USER_ROLES.flatMap((role) =>
  MODULES.flatMap((module) => ACTIONS.map((action) => ({ role, module, action }))),
);

describe('every module × role × verb', () => {
  it('produces 140 cells', () => {
    expect(CELLS).toHaveLength(140);
  });

  it.each(CELLS)('$role $action $module', async ({ role, module, action }) => {
    const expected = can(role, module, action);

    const response = await request(app)
      .get(probePath(module, action))
      .set('Authorization', `Bearer ${tokenFor(role)}`);

    if (expected.allowed) {
      expect(response.status).toBe(200);
      // The verdict alone is not the whole grant: a scoped role must be handed
      // its scope, or the handler will read rows it should never see.
      expect(response.body.scope).toBe(expected.scope);
    } else {
      // 403, never 404 — AUTH-06's acceptance criterion is only testable
      // because the status is not obfuscated.
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });
});

// ---------------------------------------------------------------------------
// Spot checks transcribed from the PRD, independent of MATRIX
// ---------------------------------------------------------------------------

describe('PRD §2.1 rules that matter most', () => {
  async function status(role: UserRole, module: Module, action: Action): Promise<number> {
    const response = await request(app)
      .get(probePath(module, action))
      .set('Authorization', `Bearer ${tokenFor(role)}`);
    return response.status;
  }

  it('user management is administrator-only', async () => {
    for (const role of USER_ROLES) {
      const expected = role === 'ADMIN' ? 200 : 403;
      for (const action of ACTIONS) {
        expect(await status(role, 'users', action), `${role}/${action}`).toBe(expected);
      }
    }
  });

  it('an accountant may read everything they can see, and write nothing', async () => {
    expect(await status('ACCOUNTANT', 'vehicles', 'read')).toBe(200);
    expect(await status('ACCOUNTANT', 'reports', 'read')).toBe(200);
    for (const action of ['create', 'update', 'delete'] as const) {
      for (const module of MODULES) {
        expect(await status('ACCOUNTANT', module, action), `${module}/${action}`).toBe(403);
      }
    }
  });

  it('a mechanic has no access to drivers or reports', async () => {
    for (const module of ['drivers', 'reports'] as const) {
      for (const action of ACTIONS) {
        expect(await status('MECHANIC', module, action), `${module}/${action}`).toBe(403);
      }
    }
  });

  it('a mechanic may update maintenance but not create or delete it', async () => {
    expect(await status('MECHANIC', 'maintenance', 'read')).toBe(200);
    expect(await status('MECHANIC', 'maintenance', 'update')).toBe(200);
    expect(await status('MECHANIC', 'maintenance', 'create')).toBe(403);
    expect(await status('MECHANIC', 'maintenance', 'delete')).toBe(403);
  });

  it('a driver may report a damage but never edit or delete one', async () => {
    expect(await status('DRIVER', 'damages', 'create')).toBe(200);
    expect(await status('DRIVER', 'damages', 'read')).toBe(200);
    expect(await status('DRIVER', 'damages', 'update')).toBe(403);
    expect(await status('DRIVER', 'damages', 'delete')).toBe(403);
  });

  it('a driver has no access to reports at all', async () => {
    for (const action of ACTIONS) {
      expect(await status('DRIVER', 'reports', action)).toBe(403);
    }
  });

  it('a fleet manager may read reports but not administer them', async () => {
    expect(await status('FLEET_MANAGER', 'reports', 'read')).toBe(200);
    expect(await status('FLEET_MANAGER', 'reports', 'delete')).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Scope publication
// ---------------------------------------------------------------------------

describe('the granted scope reaches the handler', () => {
  it('limits a driver to their own vehicle, and their own record', async () => {
    for (const module of ['vehicles', 'maintenance', 'documents', 'damages'] as const) {
      const response = await request(app)
        .get(probePath(module, 'read'))
        .set('Authorization', `Bearer ${tokenFor('DRIVER')}`);
      expect(response.body.scope, module).toBe('own_vehicle');
    }

    const drivers = await request(app)
      .get(probePath('drivers', 'read'))
      .set('Authorization', `Bearer ${tokenFor('DRIVER')}`);
    expect(drivers.body.scope).toBe('self');
  });

  it('limits a mechanic to assigned maintenance, while vehicles stay unscoped', async () => {
    const maintenance = await request(app)
      .get(probePath('maintenance', 'update'))
      .set('Authorization', `Bearer ${tokenFor('MECHANIC')}`);
    expect(maintenance.body.scope).toBe('assigned');

    // A mechanic reads the whole fleet — they need to look up any vehicle.
    const vehicles = await request(app)
      .get(probePath('vehicles', 'read'))
      .set('Authorization', `Bearer ${tokenFor('MECHANIC')}`);
    expect(vehicles.body.scope).toBe('all');
  });

  it('gives an administrator unscoped access', async () => {
    for (const module of MODULES) {
      const response = await request(app)
        .get(probePath(module, 'read'))
        .set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
      expect(response.body.scope, module).toBe('all');
    }
  });
});

// ---------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------

describe('authorisation fails closed', () => {
  it('rejects an unauthenticated caller with 401, not 403', async () => {
    const response = await request(app).get(probePath('vehicles', 'read'));
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a route wired without requireAuth rather than admitting everyone', async () => {
    const misconfigured = createApp({
      configure: (instance) => {
        // authorize() with no requireAuth in front — the mistake this guards.
        instance.get('/__broken', authorize('users', 'delete'), (_req, res) => {
          res.json({ reached: true });
        });
      },
    });

    const response = await request(misconfigured).get('/__broken');
    expect(response.status).toBe(401);
    expect(response.body.reached).toBeUndefined();
  });

  it('ignores a role asserted by the client rather than the token', async () => {
    // Header-injected role claims must have no effect whatsoever.
    const response = await request(app)
      .get(probePath('users', 'delete'))
      .set('Authorization', `Bearer ${tokenFor('DRIVER')}`)
      .set('X-Role', 'ADMIN')
      .set('X-User-Role', 'ADMIN');

    expect(response.status).toBe(403);
  });
});
