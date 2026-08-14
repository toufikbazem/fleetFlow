/**
 * Report routes — FF-1001, FF-1002 (RPT-01…07).
 *
 * All three verbs guard on `reports:read`, which the matrix grants to Admin,
 * Fleet manager and Accountant. A Mechanic and a Driver get 403 — cost data is
 * the clearest case in the product of information that is fine for one role and
 * not for another, and the export endpoint is exactly where a missing guard
 * would hand over the whole table in one request.
 */

import {
  REPORT_NAMES,
  reportExportQuerySchema,
  reportQuerySchema,
  type ReportCatalogue,
  type ReportResult,
} from '@fleetflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authorize } from '../../platform/middleware/authorize.js';
import { requireAuth } from '../../platform/middleware/require-auth.js';
import { params, query, validate } from '../../platform/middleware/validate.js';
import { catalogue, runReport, runReportForExport } from './service.js';
import { exportFilename, serialise } from './serialisers.js';

export const reportsRouter: Router = Router();

/** The report name is validated as an enum, so no unknown name reaches a query. */
const reportParamSchema = z.object({ name: z.enum(REPORT_NAMES) });

/** Lets the picker render five reports without the client hardcoding their titles. */
reportsRouter.get('/reports', requireAuth, authorize('reports', 'read'), (_req, res) => {
  const response: ReportCatalogue = catalogue();
  res.json(response);
});

reportsRouter.get(
  '/reports/:name',
  requireAuth,
  authorize('reports', 'read'),
  validate({ params: reportParamSchema, query: reportQuerySchema }),
  async (req, res) => {
    const result: ReportResult = await runReport(
      params(reportParamSchema, req).name,
      query(reportQuerySchema, req),
    );
    res.json(result);
  },
);

/**
 * RPT-06.
 *
 * The filters arrive in the query string exactly as the screen holds them, and
 * the export runs the same report function — so "the same filtered result set
 * shown on screen" is satisfied by construction, not by the client posting back
 * rows it might have modified.
 */
reportsRouter.get(
  '/reports/:name/export',
  requireAuth,
  authorize('reports', 'read'),
  validate({ params: reportParamSchema, query: reportExportQuerySchema }),
  async (req, res) => {
    const { name } = params(reportParamSchema, req);
    const { format, ...filter } = query(reportExportQuerySchema, req);

    const result = await runReportForExport(name, filter);
    const file = await serialise(result, format);

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.body.byteLength));
    // `attachment` rather than `inline`: a spreadsheet rendered in a browser tab
    // is a download the user then has to hunt for, and an HTML-sniffed CSV is a
    // way to get script into a same-origin response.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename(result, file.extension)}"`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  },
);
