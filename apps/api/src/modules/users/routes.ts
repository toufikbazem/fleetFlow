/**
 * User routes — FF-301, FF-302. Administrator-only (USR-01).
 *
 * Every route pairs `requireAuth` with `authorize('users', …)`. The matrix
 * grants `users` to ADMIN alone, so the guard is what makes that true rather
 * than a comment — and FF-207 asserts all 20 role/verb combinations for this
 * module against the PRD table.
 */

import {
  createUserRequestSchema,
  idParamSchema,
  updateUserRequestSchema,
  userListQuerySchema,
  type InviteResult,
  type UserListResponse,
  type UserResponse,
} from '@fleetflow/shared';
import { Router } from 'express';
import { authorize } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import {
  create,
  deactivate,
  getById,
  list,
  reactivate,
  remove,
  resendInvitation,
  update,
} from './service.js';

export const usersRouter: Router = Router();

usersRouter.get(
  '/users',
  requireAuth,
  authorize('users', 'read'),
  validate({ query: userListQuerySchema }),
  async (req, res) => {
    const response: UserListResponse = await list(query(userListQuerySchema, req));
    res.json(response);
  },
);

usersRouter.get(
  '/users/:id',
  requireAuth,
  authorize('users', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: UserResponse = { user: await getById(params(idParamSchema, req).id) };
    res.json(response);
  },
);

usersRouter.post(
  '/users',
  requireAuth,
  authorize('users', 'create'),
  validate({ body: createUserRequestSchema }),
  async (req, res) => {
    const result = await create(body(createUserRequestSchema, req));
    const response: InviteResult = result;
    res.status(201).json(response);
  },
);

usersRouter.patch(
  '/users/:id',
  requireAuth,
  authorize('users', 'update'),
  validate({ params: idParamSchema, body: updateUserRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const user = await update(
      actor.id,
      params(idParamSchema, req).id,
      body(updateUserRequestSchema, req),
    );
    const response: UserResponse = { user };
    res.json(response);
  },
);

/** USR-03 — distinct from delete: the account is listed, disabled, and intact. */
usersRouter.post(
  '/users/:id/deactivate',
  requireAuth,
  authorize('users', 'update'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const user = await deactivate(actor.id, params(idParamSchema, req).id);
    const response: UserResponse = { user };
    res.json(response);
  },
);

usersRouter.post(
  '/users/:id/activate',
  requireAuth,
  authorize('users', 'update'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: UserResponse = { user: await reactivate(params(idParamSchema, req).id) };
    res.json(response);
  },
);

/** USR-04 — for an account whose invitation expired or never arrived. */
usersRouter.post(
  '/users/:id/resend-invitation',
  requireAuth,
  authorize('users', 'update'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const sent = await resendInvitation(params(idParamSchema, req).id);
    res.json({ invitationSent: sent });
  },
);

usersRouter.delete(
  '/users/:id',
  requireAuth,
  authorize('users', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    await remove(actor.id, params(idParamSchema, req).id);
    res.status(204).end();
  },
);
