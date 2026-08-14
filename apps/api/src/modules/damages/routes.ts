/**
 * Damage routes — FF-701, FF-702.
 *
 * `create` is the only write a Driver has anywhere in FleetFlow (`W_REPORT`).
 * Everything else here is administrator and fleet-manager work.
 */

import {
  changeDamageStatusRequestSchema,
  convertToMaintenanceRequestSchema,
  createDamageRequestSchema,
  damageListQuerySchema,
  idParamSchema,
  updateDamageRequestSchema,
  type DamageListResponse,
  type DamageResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize, callerScope } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import {
  changeStatus,
  convertToMaintenance,
  create,
  getById,
  list,
  remove,
  setArchived,
  update,
} from './service.js';

export const damagesRouter: Router = Router();

damagesRouter.get(
  '/damages',
  requireAuth,
  authorize('damages', 'read'),
  validate({ query: damageListQuerySchema }),
  async (req, res) => {
    const response: DamageListResponse = await list(
      query(damageListQuerySchema, req),
      callerScope(req),
    );
    res.json(response);
  },
);

damagesRouter.get(
  '/damages/:id',
  requireAuth,
  authorize('damages', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: DamageResponse = {
      damage: await getById(params(idParamSchema, req).id, callerScope(req)),
    };
    res.json(response);
  },
);

/** DMG-03 — the driver's report. */
damagesRouter.post(
  '/damages',
  requireAuth,
  authorize('damages', 'create'),
  validate({ body: createDamageRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const response: DamageResponse = {
      damage: await create(body(createDamageRequestSchema, req), callerScope(req), actor.id),
    };
    res.status(201).json(response);
  },
);

damagesRouter.patch(
  '/damages/:id',
  requireAuth,
  authorize('damages', 'update'),
  validate({ params: idParamSchema, body: updateDamageRequestSchema }),
  async (req, res) => {
    const response: DamageResponse = {
      damage: await update(
        params(idParamSchema, req).id,
        body(updateDamageRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

/** Triage: under review, resolved or rejected. LINKED is reached by conversion. */
damagesRouter.patch(
  '/damages/:id/status',
  requireAuth,
  authorize('damages', 'update'),
  validate({ params: idParamSchema, body: changeDamageStatusRequestSchema }),
  async (req, res) => {
    const response: DamageResponse = {
      damage: await changeStatus(
        params(idParamSchema, req).id,
        body(changeDamageStatusRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

damagesRouter.post(
  '/damages/:id/archive',
  requireAuth,
  authorize('damages', 'update'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: DamageResponse = {
      damage: await setArchived(params(idParamSchema, req).id, true, callerScope(req)),
    };
    res.json(response);
  },
);

damagesRouter.post(
  '/damages/:id/restore',
  requireAuth,
  authorize('damages', 'update'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: DamageResponse = {
      damage: await setArchived(params(idParamSchema, req).id, false, callerScope(req)),
    };
    res.json(response);
  },
);

/** DMG-02. */
damagesRouter.post(
  '/damages/:id/convert-to-maintenance',
  requireAuth,
  authorize('damages', 'update'),
  validate({ params: idParamSchema, body: convertToMaintenanceRequestSchema }),
  async (req, res) => {
    const result = await convertToMaintenance(
      params(idParamSchema, req).id,
      body(convertToMaintenanceRequestSchema, req),
      callerScope(req),
    );
    res.status(201).json(result);
  },
);

damagesRouter.delete(
  '/damages/:id',
  requireAuth,
  authorize('damages', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await remove(params(idParamSchema, req).id, callerScope(req));
    res.status(204).end();
  },
);
