/**
 * Maintenance routes — FF-501…FF-504.
 *
 * A Mechanic has `W_ASSIGNED` on maintenance: read and update, scoped to jobs
 * assigned to them. They cannot create or delete work, and the repository's
 * scope filter — not this file — is what keeps them from seeing anyone else's.
 */

import {
  assignMechanicRequestSchema,
  changeMaintenanceStatusRequestSchema,
  createMaintenanceOpRequestSchema,
  createMaintenancePlanRequestSchema,
  idParamSchema,
  maintenanceOpListQuerySchema,
  maintenancePlanListQuerySchema,
  updateMaintenanceOpRequestSchema,
  updateMaintenancePlanRequestSchema,
  type MaintenanceOpListResponse,
  type MaintenanceOpResponse,
  type MaintenancePlanListResponse,
  type MaintenancePlanResponse,
  type TriggerRunResult,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize, callerScope } from '../../platform/middleware/authorize.js';
import { requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import {
  assignMechanic,
  changeStatus,
  createOperation,
  deleteOperation,
  getOperation,
  listOperations,
  updateOperation,
} from './operations.js';
import { createPlan, deletePlan, getPlan, listPlans, updatePlan } from './plans.js';
import { runTriggerEngine } from './trigger-engine.js';

export const maintenanceRouter: Router = Router();

// ---------------------------------------------------------------------------
// Plans — MNT-04
// ---------------------------------------------------------------------------

maintenanceRouter.get(
  '/maintenance-plans',
  requireAuth,
  authorize('maintenance', 'read'),
  validate({ query: maintenancePlanListQuerySchema }),
  async (req, res) => {
    const response: MaintenancePlanListResponse = await listPlans(
      query(maintenancePlanListQuerySchema, req),
    );
    res.json(response);
  },
);

maintenanceRouter.get(
  '/maintenance-plans/:id',
  requireAuth,
  authorize('maintenance', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: MaintenancePlanResponse = {
      plan: await getPlan(params(idParamSchema, req).id),
    };
    res.json(response);
  },
);

maintenanceRouter.post(
  '/maintenance-plans',
  requireAuth,
  authorize('maintenance', 'create'),
  validate({ body: createMaintenancePlanRequestSchema }),
  async (req, res) => {
    const response: MaintenancePlanResponse = {
      plan: await createPlan(body(createMaintenancePlanRequestSchema, req)),
    };
    res.status(201).json(response);
  },
);

maintenanceRouter.patch(
  '/maintenance-plans/:id',
  requireAuth,
  authorize('maintenance', 'update'),
  validate({ params: idParamSchema, body: updateMaintenancePlanRequestSchema }),
  async (req, res) => {
    const response: MaintenancePlanResponse = {
      plan: await updatePlan(
        params(idParamSchema, req).id,
        body(updateMaintenancePlanRequestSchema, req),
      ),
    };
    res.json(response);
  },
);

maintenanceRouter.delete(
  '/maintenance-plans/:id',
  requireAuth,
  authorize('maintenance', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await deletePlan(params(idParamSchema, req).id);
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Operations — MNT-01, MNT-05, MNT-06, MNT-07
// ---------------------------------------------------------------------------

maintenanceRouter.get(
  '/maintenance',
  requireAuth,
  authorize('maintenance', 'read'),
  validate({ query: maintenanceOpListQuerySchema }),
  async (req, res) => {
    const response: MaintenanceOpListResponse = await listOperations(
      query(maintenanceOpListQuerySchema, req),
      callerScope(req),
    );
    res.json(response);
  },
);

maintenanceRouter.get(
  '/maintenance/:id',
  requireAuth,
  authorize('maintenance', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: MaintenanceOpResponse = {
      operation: await getOperation(params(idParamSchema, req).id, callerScope(req)),
    };
    res.json(response);
  },
);

maintenanceRouter.post(
  '/maintenance',
  requireAuth,
  authorize('maintenance', 'create'),
  validate({ body: createMaintenanceOpRequestSchema }),
  async (req, res) => {
    const response: MaintenanceOpResponse = {
      operation: await createOperation(
        body(createMaintenanceOpRequestSchema, req),
        callerScope(req),
      ),
    };
    res.status(201).json(response);
  },
);

maintenanceRouter.patch(
  '/maintenance/:id',
  requireAuth,
  authorize('maintenance', 'update'),
  validate({ params: idParamSchema, body: updateMaintenanceOpRequestSchema }),
  async (req, res) => {
    const response: MaintenanceOpResponse = {
      operation: await updateOperation(
        params(idParamSchema, req).id,
        body(updateMaintenanceOpRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

/** MNT-06 — the workflow a mechanic drives. */
maintenanceRouter.patch(
  '/maintenance/:id/status',
  requireAuth,
  authorize('maintenance', 'update'),
  validate({ params: idParamSchema, body: changeMaintenanceStatusRequestSchema }),
  async (req, res) => {
    const response: MaintenanceOpResponse = {
      operation: await changeStatus(
        params(idParamSchema, req).id,
        body(changeMaintenanceStatusRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

maintenanceRouter.post(
  '/maintenance/:id/assign',
  requireAuth,
  authorize('maintenance', 'update'),
  validate({ params: idParamSchema, body: assignMechanicRequestSchema }),
  async (req, res) => {
    const response: MaintenanceOpResponse = {
      operation: await assignMechanic(
        params(idParamSchema, req).id,
        body(assignMechanicRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

maintenanceRouter.delete(
  '/maintenance/:id',
  requireAuth,
  authorize('maintenance', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await deleteOperation(params(idParamSchema, req).id, callerScope(req));
    res.status(204).end();
  },
);

/**
 * FF-503, run on demand.
 *
 * The scheduled daily run arrives with FF-803's worker. This endpoint exists so
 * the engine can be exercised now, and so an operator can re-run it during UAT
 * — which is exactly when a non-idempotent engine would double-book every
 * vehicle in the fleet. It is safe to call repeatedly by construction.
 */
maintenanceRouter.post(
  '/maintenance/run-triggers',
  requireAuth,
  authorize('maintenance', 'create'),
  async (_req, res) => {
    const result: TriggerRunResult = await runTriggerEngine();
    res.json(result);
  },
);
