/**
 * Reports contract — RPT-01…07.
 *
 * **One shape for all five reports, and that is the whole design.**
 *
 * RPT-06's acceptance criterion is that all three export formats are produced
 * from the same filtered result set shown on screen. The obvious implementation
 * — five report queries, each with a bespoke response, times three serialisers —
 * is fifteen places for a column to be formatted differently, rounded
 * differently, or quietly omitted. Nobody notices until an accountant reconciles
 * a PDF against the screen and the totals differ by a rounding step.
 *
 * So a report is a *table*: a list of typed columns and a list of rows keyed by
 * those columns. Every serialiser consumes that one shape, which makes "the CSV
 * matches the screen" true by construction rather than by testing fifteen
 * combinations. Adding a sixth report means adding a query, not a format.
 *
 * The column `type` is what lets a generic serialiser stay correct: a money
 * column has to be right-aligned in xlsx with two decimals, written unformatted
 * in CSV so a spreadsheet can still sum it, and rendered with a currency symbol
 * in PDF. That is a property of the column, not of the report.
 */

import { z } from 'zod';
import { EXPORT_FORMATS, REPORT_NAMES } from '../enums.js';
import { dateOnlySchema, uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * How a value should be read, not how it should look.
 *
 * `money` and `number` are distinct because only one of them carries a currency;
 * `integer` and `number` because a count of operations must never render as
 * "3.00". `date` values travel as `YYYY-MM-DD` strings so the serialisers never
 * have to guess a timezone.
 */
export const REPORT_COLUMN_TYPES = ['text', 'integer', 'number', 'money', 'date'] as const;
export type ReportColumnType = (typeof REPORT_COLUMN_TYPES)[number];

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(REPORT_COLUMN_TYPES),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

/** A cell. `null` is "no value", which is not the same as zero or an empty string. */
export const reportCellSchema = z.union([z.string(), z.number(), z.null()]);
export type ReportCell = z.infer<typeof reportCellSchema>;

export const reportRowSchema = z.record(z.string(), reportCellSchema);
export type ReportRow = z.infer<typeof reportRowSchema>;

// ---------------------------------------------------------------------------
// Filters — RPT-07
// ---------------------------------------------------------------------------

/**
 * The same filter bar drives every report.
 *
 * Not every report uses every filter — `driverId` means nothing to the cost
 * summary — and that is deliberate: one filter shape means the UI has one
 * component and the export endpoint accepts exactly what the screen sent, so an
 * export can never be computed over a different set than the one displayed.
 * A report ignores what does not apply to it, and says so in `appliedFilters`.
 */
export const reportFilterSchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  vehicleId: uuidSchema.optional(),
  driverId: uuidSchema.optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const reportQuerySchema = reportFilterSchema
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const reportExportQuerySchema = reportFilterSchema.extend({
  format: z.enum(EXPORT_FORMATS),
});
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export const reportResultSchema = z.object({
  report: z.enum(REPORT_NAMES),
  title: z.string(),
  /** One line saying what the reader is looking at, carried into the PDF header. */
  description: z.string(),
  generatedAt: z.string(),
  columns: z.array(reportColumnSchema),
  rows: z.array(reportRowSchema),
  /**
   * Column totals, keyed the same way as a row.
   *
   * Computed by the database over the *whole* filtered set, not by adding up the
   * page on screen — a footer that sums only the visible rows is the single most
   * common way a report lies to the person reading it.
   */
  totals: reportRowSchema.nullable(),
  /** Echoed back so an export and a screen can be shown to have used the same filters. */
  appliedFilters: reportFilterSchema,
  /** Which of the four filters this report actually honours. */
  supportedFilters: z.array(z.enum(['from', 'to', 'vehicleId', 'driverId'])),
  currency: z.string(),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

/** Metadata for the report picker, so the UI does not hardcode five titles. */
export const reportDescriptorSchema = z.object({
  name: z.enum(REPORT_NAMES),
  title: z.string(),
  description: z.string(),
  supportedFilters: z.array(z.enum(['from', 'to', 'vehicleId', 'driverId'])),
});
export type ReportDescriptor = z.infer<typeof reportDescriptorSchema>;

export const reportCatalogueSchema = z.object({ reports: z.array(reportDescriptorSchema) });
export type ReportCatalogue = z.infer<typeof reportCatalogueSchema>;
