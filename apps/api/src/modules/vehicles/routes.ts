/**
 * Vehicle routes — FF-401…FF-405.
 *
 * Read is granted to every role (a Driver scoped to their own vehicle); writes
 * to administrators and fleet managers. All of it from the matrix.
 */

import {
  changeVehicleStatusRequestSchema,
  createVehicleRequestSchema,
  idParamSchema,
  paginationQuerySchema,
  recordMileageRequestSchema,
  updateVehicleRequestSchema,
  vehicleListQuerySchema,
  type MileageHistoryResponse,
  type VehicleListResponse,
  type VehicleOverview,
  type VehicleResponse,
  type VehicleTypeListResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize, callerScope } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import { listVehicleTypes } from './repository.js';
import {
  addMileage,
  changeStatus,
  create,
  getById,
  getMileage,
  getOverview,
  list,
  remove,
  update,
} from './service.js';

export const vehiclesRouter: Router = Router();

/** Reference data for the vehicle form. Read access to vehicles is enough. */
vehiclesRouter.get(
  '/vehicle-types',
  requireAuth,
  authorize('vehicles', 'read'),
  async (_req, res) => {
    const response: VehicleTypeListResponse = { data: await listVehicleTypes() };
    res.json(response);
  },
);

vehiclesRouter.get(
  '/vehicles',
  requireAuth,
  authorize('vehicles', 'read'),
  validate({ query: vehicleListQuerySchema }),
  async (req, res) => {
    const response: VehicleListResponse = await list(
      query(vehicleListQuerySchema, req),
      callerScope(req),
    );
    res.json(response);
  },
);

vehiclesRouter.get(
  '/vehicles/:id',
  requireAuth,
  authorize('vehicles', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: VehicleResponse = {
      vehicle: await getById(params(idParamSchema, req).id, callerScope(req)),
    };
    res.json(response);
  },
);

/** VEH-02 — the four aggregate sections in one response. */
vehiclesRouter.get(
  '/vehicles/:id/overview',
  requireAuth,
  authorize('vehicles', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: VehicleOverview = await getOverview(
      params(idParamSchema, req).id,
      callerScope(req),
    );
    res.json(response);
  },
);

vehiclesRouter.get(
  '/vehicles/:id/mileage',
  requireAuth,
  authorize('vehicles', 'read'),
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  async (req, res) => {
    const page = query(paginationQuerySchema, req);
    const response: MileageHistoryResponse = await getMileage(
      params(idParamSchema, req).id,
      callerScope(req),
      page.page,
      page.pageSize,
    );
    res.json(response);
  },
);

/**
 * VEH-05.
 *
 * Deliberately a vehicles:update permission, not vehicles:read — recording an
 * odometer reading changes what maintenance is due, so it is a write even
 * though it reads like an observation.
 */
vehiclesRouter.post(
  '/vehicles/:id/mileage',
  requireAuth,
  authorize('vehicles', 'update'),
  validate({ params: idParamSchema, body: recordMileageRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const reading = await addMileage(
      params(idParamSchema, req).id,
      body(recordMileageRequestSchema, req),
      callerScope(req),
      actor.id,
    );
    res.status(201).json({ reading });
  },
);

vehiclesRouter.post(
  '/vehicles',
  requireAuth,
  authorize('vehicles', 'create'),
  validate({ body: createVehicleRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const response: VehicleResponse = {
      vehicle: await create(body(createVehicleRequestSchema, req), actor.id),
    };
    res.status(201).json(response);
  },
);

vehiclesRouter.patch(
  '/vehicles/:id',
  requireAuth,
  authorize('vehicles', 'update'),
  validate({ params: idParamSchema, body: updateVehicleRequestSchema }),
  async (req, res) => {
    const response: VehicleResponse = {
      vehicle: await update(
        params(idParamSchema, req).id,
        body(updateVehicleRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

/** VEH-06 — archiving and returning to service are lifecycle events, not edits. */
vehiclesRouter.post(
  '/vehicles/:id/status',
  requireAuth,
  authorize('vehicles', 'update'),
  validate({ params: idParamSchema, body: changeVehicleStatusRequestSchema }),
  async (req, res) => {
    const response: VehicleResponse = {
      vehicle: await changeStatus(
        params(idParamSchema, req).id,
        body(changeVehicleStatusRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

vehiclesRouter.delete(
  '/vehicles/:id',
  requireAuth,
  authorize('vehicles', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await remove(params(idParamSchema, req).id, callerScope(req));
    res.status(204).end();
  },
);
