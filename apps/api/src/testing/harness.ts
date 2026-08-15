/**
 * Integration-test harness — FF-1201.
 *
 * Eighty endpoints across ten modules need the same four things: an app, a
 * token per role, seeded ids to act on, and a way to undo whatever the test
 * wrote. Without a shared harness each suite grows its own copy, they drift,
 * and the slow ones stop being run.
 *
 * **State discipline is the hard part.** These suites share one database and
 * run serially (`fileParallelism: false`). A test that creates a vehicle and
 * leaves it there changes the counts every later test asserts on, and the
 * failure surfaces in a different file — which is the most expensive kind of
 * test failure to diagnose. So everything created here is registered for
 * teardown and hard-deleted afterwards, and the seeded baseline is verified.
 */

import type { UserRole } from '@fleetflow/shared';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../app.js';
import { disconnectDb, withDeleted } from '../platform/db.js';
import { resetRateLimits } from '../platform/rate-limit.js';
import { connectRedis, disconnectRedis } from '../platform/redis.js';

export const PASSWORD = 'FleetFlow-Dev-2026!';

export const ACCOUNTS: Record<UserRole, string> = {
  ADMIN: 'admin@fleetflow.local',
  FLEET_MANAGER: 'manager@fleetflow.local',
  MECHANIC: 'mechanic@fleetflow.local',
  ACCOUNTANT: 'accountant@fleetflow.local',
  DRIVER: 'amina@fleetflow.local',
};

/**
 * Fixed ids from `prisma/seed.ts`.
 *
 * Named rather than looked up, so a test that depends on "the vehicle with an
 * open assignment" says so instead of taking whatever `findFirst` returned that
 * day — which is how a suite starts passing for the wrong reason.
 */
export const SEED = {
  user: {
    admin: '00000000-0000-4000-8000-000000000001',
    manager: '00000000-0000-4000-8000-000000000002',
    mechanic: '00000000-0000-4000-8000-000000000003',
    accountant: '00000000-0000-4000-8000-000000000004',
    driverAmina: '00000000-0000-4000-8000-000000000005',
    driverYoussef: '00000000-0000-4000-8000-000000000006',
  },
  driver: {
    amina: '00000000-0000-4000-8000-000000000101',
    youssef: '00000000-0000-4000-8000-000000000102',
    /** No login account — DRV-04 makes the link optional, and most drivers have none. */
    unlinked: '00000000-0000-4000-8000-000000000103',
  },
  vehicleType: {
    van: '00000000-0000-4000-8000-000000000201',
    truck: '00000000-0000-4000-8000-000000000202',
    car: '00000000-0000-4000-8000-000000000203',
  },
  vehicle: {
    /** ACTIVE, assigned to Amina, carries the completed maintenance and its cost. */
    van1: '00000000-0000-4000-8000-000000000301',
    /** ACTIVE, unassigned. */
    van2: '00000000-0000-4000-8000-000000000302',
    /** UNDER_MAINTENANCE, assigned to Youssef. */
    truck1: '00000000-0000-4000-8000-000000000303',
    /** Carries the overdue inspection. */
    car1: '00000000-0000-4000-8000-000000000304',
    archived: '00000000-0000-4000-8000-000000000305',
  },
  assignment: {
    van1Open: '00000000-0000-4000-8000-000000000401',
    truck1Open: '00000000-0000-4000-8000-000000000402',
    van1Closed: '00000000-0000-4000-8000-000000000403',
  },
  plan: {
    vanService: '00000000-0000-4000-8000-000000000501',
    truckService: '00000000-0000-4000-8000-000000000502',
    car1Specific: '00000000-0000-4000-8000-000000000503',
  },
  op: {
    planned: '00000000-0000-4000-8000-000000000601',
    inProgress: '00000000-0000-4000-8000-000000000602',
    completed: '00000000-0000-4000-8000-000000000603',
    overdue: '00000000-0000-4000-8000-000000000604',
  },
  document: {
    van1Insurance: '00000000-0000-4000-8000-000000000701',
    /** Technical inspection, expiring soon. */
    van1Inspection: '00000000-0000-4000-8000-000000000702',
    /** Already expired. */
    truck1Insurance: '00000000-0000-4000-8000-000000000703',
    car1Registration: '00000000-0000-4000-8000-000000000704',
  },
  damage: {
    reported: '00000000-0000-4000-8000-000000000801',
  },
} as const;

export interface Harness {
  app: Express;
  token(role: UserRole): string;
  /** An `Authorization` header for supertest's `.set()`. */
  auth(role: UserRole): { Authorization: string };
  /** Registers a row for hard deletion in teardown. */
  track(table: TrackableTable, id: string): void;
  /** Rows this suite created, consumed by `teardownHarness`. */
  readonly created: Map<TrackableTable, Set<string>>;
}

/** Tables a test may create rows in. Ordered children-first for teardown. */
export type TrackableTable =
  | 'notificationDelivery'
  | 'notification'
  | 'attachment'
  | 'mileageReading'
  | 'maintenanceOp'
  | 'maintenancePlan'
  | 'document'
  | 'damage'
  | 'assignment'
  | 'vehicle'
  | 'driver'
  | 'user'
  | 'documentType'
  | 'vehicleType';

/**
 * Deletion order.
 *
 * Children before parents: a vehicle cannot be removed while a maintenance
 * operation still references it, and a failure here would leave the database
 * dirty for every suite that follows.
 */
const TEARDOWN_ORDER: TrackableTable[] = [
  'notificationDelivery',
  'notification',
  'attachment',
  'mileageReading',
  'maintenanceOp',
  'maintenancePlan',
  'document',
  'damage',
  'assignment',
  'vehicle',
  'driver',
  'user',
  'documentType',
  'vehicleType',
];

export async function setupHarness(): Promise<Harness> {
  await connectRedis();
  // AUTH-05's per-IP counter is shared across every suite hitting this Redis,
  // and ten suites each signing in as five roles will otherwise trip it.
  await resetRateLimits();

  const app = createApp();
  const tokens = new Map<UserRole, string>();

  for (const [role, email] of Object.entries(ACCOUNTS) as Array<[UserRole, string]>) {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });

    if (response.status !== 200) {
      throw new Error(
        `Could not sign in as ${role} (${email}): ${response.status}. ` +
          'Has the database been seeded? `npm run db:seed`.',
      );
    }
    tokens.set(role, response.body.accessToken as string);
  }

  const created = new Map<TrackableTable, Set<string>>();

  function token(role: UserRole): string {
    const value = tokens.get(role);
    if (!value) throw new Error(`No token for ${role}`);
    return value;
  }

  return {
    app,
    created,
    token,
    auth: (role) => ({ Authorization: `Bearer ${token(role)}` }),
    track(table, id) {
      const set = created.get(table) ?? new Set<string>();
      set.add(id);
      created.set(table, set);
    },
  };
}

/**
 * Removes everything the suite created and drops the connections.
 *
 * Hard delete through `withDeleted()`, not the soft-delete client: a test that
 * archived a vehicle would otherwise leave a `deleted_at` row behind, invisible
 * to later reads but still holding the unique plate.
 */
export async function teardownHarness(harness: Harness): Promise<void> {
  const db = withDeleted();

  for (const table of TEARDOWN_ORDER) {
    const ids = [...(harness.created.get(table) ?? [])];
    if (ids.length === 0) continue;
    // `as never`: the delegate is selected by a runtime string, which the
    // generated union cannot narrow. Every member has `deleteMany`.
    await (db[table] as { deleteMany: (args: unknown) => Promise<unknown> }).deleteMany({
      where: { id: { in: ids } },
    } as never);
  }

  await Promise.allSettled([disconnectDb(), disconnectRedis()]);
}

/** Unique enough to run the suite twice without tripping a unique index. */
export function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
