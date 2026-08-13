/**
 * Driver routes — FF-303.
 *
 * Read is granted to ADMIN, FLEET_MANAGER, ACCOUNTANT (all records) and DRIVER
 * (own record only). Writes are ADMIN and FLEET_MANAGER. All of it comes from
 * the matrix; none of it is decided here.
 */

import {
  createDriverRequestSchema,
  driverListQuerySchema,
  idParamSchema,
  updateDriverRequestSchema,
  type DriverListResponse,
  type DriverResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize, callerScope } from '../../platform/middleware/authorize.js';
import { requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import { create, getById, list, remove, update } from './service.js';

export const driversRouter: Router = Router();

driversRouter.get(
  '/drivers',
  requireAuth,
  authorize('drivers', 'read'),
  validate({ query: driverListQuerySchema }),
  async (req, res) => {
    const response: DriverListResponse = await list(
      query(driverListQuerySchema, req),
      // The scope resolved by authorize() — a DRIVER sees one row, everyone
      // else with read access sees all of them.
      callerScope(req),
    );
    res.json(response);
  },
);

driversRouter.get(
  '/drivers/:id',
  requireAuth,
  authorize('drivers', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const driver = await getById(params(idParamSchema, req).id, callerScope(req));
    const response: DriverResponse = { driver };
    res.json(response);
  },
);

driversRouter.post(
  '/drivers',
  requireAuth,
  authorize('drivers', 'create'),
  validate({ body: createDriverRequestSchema }),
  async (req, res) => {
    const response: DriverResponse = { driver: await create(body(createDriverRequestSchema, req)) };
    res.status(201).json(response);
  },
);

driversRouter.patch(
  '/drivers/:id',
  requireAuth,
  authorize('drivers', 'update'),
  validate({ params: idParamSchema, body: updateDriverRequestSchema }),
  async (req, res) => {
    const driver = await update(
      params(idParamSchema, req).id,
      body(updateDriverRequestSchema, req),
      callerScope(req),
    );
    const response: DriverResponse = { driver };
    res.json(response);
  },
);

driversRouter.delete(
  '/drivers/:id',
  requireAuth,
  authorize('drivers', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await remove(params(idParamSchema, req).id, callerScope(req));
    res.status(204).end();
  },
);
