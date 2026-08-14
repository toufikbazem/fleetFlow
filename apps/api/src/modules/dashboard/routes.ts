/**
 * Dashboard route — FF-901 (DSH-01…08).
 *
 * `requireAuth` with no `authorize()`, because no single module governs this
 * screen: it is assembled from four permissions and each section resolves its
 * own. See the note at the top of `service.ts` — the matrix is still the only
 * authority, consulted through the same `can()` the middleware uses.
 */

import type { Dashboard } from '@fleetflow/shared';
import { Router } from 'express';
import { callerIdentity } from '../../platform/middleware/authorize.js';
import { requireAuth } from '../../platform/middleware/require-auth.js';
import { getDashboard } from './service.js';

export const dashboardRouter: Router = Router();

dashboardRouter.get('/dashboard', requireAuth, async (req, res) => {
  const dashboard: Dashboard = await getDashboard(callerIdentity(req));
  res.json(dashboard);
});
