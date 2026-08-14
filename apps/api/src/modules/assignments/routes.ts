/**
 * Assignment routes — FF-404.
 *
 * Authorised against `drivers`, because an assignment is a statement about who
 * drives what: a Mechanic has no access to drivers and therefore none here,
 * while an Accountant can read the history for the assignment report (RPT-04).
 */

import {
  assignmentListQuerySchema,
  closeAssignmentRequestSchema,
  createAssignmentRequestSchema,
  idParamSchema,
  type AssignmentListResponse,
  type AssignmentResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize, callerScope } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import { close, create, list } from './service.js';

export const assignmentsRouter: Router = Router();

assignmentsRouter.get(
  '/assignments',
  requireAuth,
  authorize('drivers', 'read'),
  validate({ query: assignmentListQuerySchema }),
  async (req, res) => {
    const response: AssignmentListResponse = await list(
      query(assignmentListQuerySchema, req),
      callerScope(req),
    );
    res.json(response);
  },
);

assignmentsRouter.post(
  '/assignments',
  requireAuth,
  authorize('drivers', 'update'),
  validate({ body: createAssignmentRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const response: AssignmentResponse = {
      assignment: await create(
        body(createAssignmentRequestSchema, req),
        callerScope(req),
        actor.id,
      ),
    };
    res.status(201).json(response);
  },
);

assignmentsRouter.patch(
  '/assignments/:id/close',
  requireAuth,
  authorize('drivers', 'update'),
  validate({ params: idParamSchema, body: closeAssignmentRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const response: AssignmentResponse = {
      assignment: await close(
        params(idParamSchema, req).id,
        body(closeAssignmentRequestSchema, req),
        callerScope(req),
        actor.id,
      ),
    };
    res.json(response);
  },
);
