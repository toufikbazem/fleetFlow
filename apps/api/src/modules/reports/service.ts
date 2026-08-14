/**
 * Report execution — FF-1001, FF-1002.
 *
 * The screen and the export call the same function; they differ only in whether
 * they ask for a page or for everything. That is deliberate — RPT-06's
 * acceptance criterion is about the two agreeing, and the cheapest way to keep
 * two things in agreement is to make them one thing.
 */

import type {
  ReportCatalogue,
  ReportFilter,
  ReportName,
  ReportQuery,
  ReportResult,
} from '@fleetflow/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { loadSettingsBranch } from '../../platform/settings.js';
import { REPORTS, type ReportSlice } from './definitions.js';

const log = childLogger('reports');

/**
 * The cap on an export.
 *
 * An unbounded export is a way to run the API out of memory from a URL: every
 * row is held in an array, then again in a workbook, then again as a buffer.
 * 50 000 rows is far beyond the reference dataset (§7, Q2: 250 vehicles) and
 * still only a few tens of megabytes at peak. Hitting it is reported as a
 * refusal rather than silently truncating the file, because a truncated export
 * that reconciles with nothing is worse than no export at all.
 */
export const MAX_EXPORT_ROWS = 50_000;

function definitionFor(name: ReportName) {
  const definition = REPORTS[name];
  if (!definition) throw new NotFoundError('Report');
  return definition;
}

/** Filters this report ignores are dropped, so what is echoed back is the truth. */
function applicableFilters(name: ReportName, filter: ReportFilter): ReportFilter {
  const supported = new Set<string>(definitionFor(name).supportedFilters);
  return {
    from: supported.has('from') ? filter.from : undefined,
    to: supported.has('to') ? filter.to : undefined,
    vehicleId: supported.has('vehicleId') ? filter.vehicleId : undefined,
    driverId: supported.has('driverId') ? filter.driverId : undefined,
  };
}

async function run(
  name: ReportName,
  filter: ReportFilter,
  slice: ReportSlice,
): Promise<ReportResult> {
  const definition = definitionFor(name);
  const applied = applicableFilters(name, filter);

  const started = Date.now();
  const table = await definition.run(applied, slice);
  log.info(
    { report: name, rows: table.rows.length, total: table.total, elapsedMs: Date.now() - started },
    'Report executed',
  );

  const general = await loadSettingsBranch('general');

  return {
    report: name,
    title: definition.title,
    description: definition.description,
    generatedAt: new Date().toISOString(),
    columns: table.columns,
    rows: table.rows,
    totals: table.totals,
    appliedFilters: applied,
    supportedFilters: definition.supportedFilters,
    currency: general.currency,
    page: slice.limit === undefined ? 1 : Math.floor((slice.offset ?? 0) / slice.limit) + 1,
    pageSize: slice.limit ?? table.rows.length,
    total: table.total,
  };
}

/** One page, for the screen. */
export function runReport(name: ReportName, query: ReportQuery): Promise<ReportResult> {
  return run(name, query, {
    offset: (query.page - 1) * query.pageSize,
    limit: query.pageSize,
  });
}

/**
 * The whole filtered set, for an export.
 *
 * Note what is *not* passed through: the page. An export reflects the filters on
 * screen, not the slice of them the reader happens to be looking at — a
 * spreadsheet containing rows 26 to 50 of a report is not an export of that
 * report.
 */
export async function runReportForExport(
  name: ReportName,
  filter: ReportFilter,
): Promise<ReportResult> {
  // Asking for one row past the cap is how the cap is detected without a second
  // counting query: if the extra row comes back, there was more than allowed.
  const result = await run(name, filter, { offset: 0, limit: MAX_EXPORT_ROWS + 1 });

  if (result.rows.length > MAX_EXPORT_ROWS) {
    throw new ValidationError(
      [
        {
          path: 'from',
          message: `Narrow the date range or pick a single vehicle: this export would contain over ${MAX_EXPORT_ROWS.toLocaleString('en-US')} rows.`,
        },
      ],
      'This export is too large.',
    );
  }

  return { ...result, page: 1, pageSize: result.rows.length };
}

export function catalogue(): ReportCatalogue {
  return {
    reports: Object.values(REPORTS).map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      supportedFilters: definition.supportedFilters,
    })),
  };
}
