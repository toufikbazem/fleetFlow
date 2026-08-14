/**
 * Export serialisers — FF-1002 (RPT-06).
 *
 * **One result set, three serialisers.** Each function below takes the same
 * `ReportResult` the screen renders and turns it into bytes. None of them knows
 * which report it is looking at, and none of them can query anything — the only
 * input is the table that was already displayed. That is what makes "all three
 * export formats are produced from the same filtered result set shown on screen"
 * structurally true rather than a thing to be tested three times per report.
 *
 * The formats differ in one important way, and it is worth being explicit:
 *
 * - **CSV and xlsx carry raw numbers**, so the recipient can sum, pivot and
 *   re-format them. A CSV containing `"$1,234.50"` is a string that no
 *   spreadsheet will add up, which defeats the purpose of exporting to CSV.
 * - **PDF carries formatted text**, because it is the read-only artefact. It is
 *   the only place a currency symbol and thousands separators belong.
 */

import type { ReportCell, ReportColumn, ReportResult, ReportRow } from '@fleetflow/shared';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import type { Alignment, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces.js';

/**
 * pdfmake 0.3 is `module.exports = new Pdfmake()` — a CommonJS *instance*, not
 * the 0.2-era `PdfPrinter` class and not a module with named exports.
 *
 * `import * as pdfmake` therefore typechecks against `@types/pdfmake` (which
 * declares the API as named exports) and then fails at runtime with
 * "addFonts is not a function": the methods live on the instance's prototype,
 * so Node's CJS named-export detection never sees them. `createRequire` gets
 * the real object, and the assertion is accurate because the published types
 * do describe exactly this instance's surface.
 */
const pdfmake = createRequire(import.meta.url)('pdfmake') as typeof import('pdfmake');

export interface SerialisedReport {
  body: Buffer;
  contentType: string;
  extension: string;
}

/** `expiring-documents-2026-08-14.csv` — dated, so a saved file stays identifiable. */
export function exportFilename(result: ReportResult, extension: string): string {
  const date = result.generatedAt.split('T')[0] ?? 'export';
  return `${result.report}-${date}.${extension}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than text.
 *
 * `-` and `+` are included because `-1+1` is arithmetic to Excel, and both are
 * accepted as formula starters; tab and carriage return are included because
 * leading whitespace is stripped before the first character is examined.
 */
const FORMULA_STARTERS = /^[=+\-@\t\r]/;

/**
 * Neutralises CSV formula injection.
 *
 * A cell beginning `=`, `+`, `-` or `@` is executed as a formula when the file
 * is opened in Excel, LibreOffice or Sheets. Several columns in these reports
 * carry text somebody typed into FleetFlow — a vendor name, a maintenance
 * title, a driver's name — so a user who can write any of them can put a
 * formula into a file that an accountant later opens. `=HYPERLINK(...)` to
 * exfiltrate the row, or a DDE payload to run a command, both work.
 *
 * The fix is the standard one: a leading apostrophe, which every spreadsheet
 * reads as "what follows is text" and does not display as part of the value.
 * Applied only to CSV — an xlsx string cell is never evaluated (a formula there
 * requires an explicit formula cell), and a PDF is inert.
 */
function neutraliseFormula(text: string): string {
  return FORMULA_STARTERS.test(text) ? `'${text}` : text;
}

/**
 * RFC 4180 quoting.
 *
 * A value is quoted if it contains a comma, a quote or a newline — a vendor
 * called "Auto Parts, Ltd." otherwise silently becomes two columns and shifts
 * every subsequent field in that row.
 */
function csvEscape(value: ReportCell): string {
  if (value === null) return '';
  // Numbers are not neutralised: they are ours, never a user's text, and a
  // negative cost prefixed with an apostrophe would stop being a number that a
  // spreadsheet can sum — which is the entire reason for exporting CSV.
  if (typeof value === 'number') return String(value);

  const text = neutraliseFormula(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(result: ReportResult): SerialisedReport {
  const lines: string[] = [];

  lines.push(result.columns.map((column) => csvEscape(column.label)).join(','));

  for (const row of result.rows) {
    lines.push(result.columns.map((column) => csvEscape(row[column.key] ?? null)).join(','));
  }

  if (result.totals) {
    lines.push(
      result.columns.map((column) => csvEscape(result.totals?.[column.key] ?? null)).join(','),
    );
  }

  // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows — the likeliest
  // consumer here — reads accented vendor and driver names correctly instead of
  // showing mojibake. Without it Excel assumes the local ANSI codepage.
  const body = Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(lines.join('\r\n'), 'utf8')]);

  return { body, contentType: 'text/csv; charset=utf-8', extension: 'csv' };
}

// ---------------------------------------------------------------------------
// xlsx
// ---------------------------------------------------------------------------

/** Number formats by column type. Money gets two decimals and a thousands separator. */
function numberFormat(column: ReportColumn): string | undefined {
  switch (column.type) {
    case 'money':
      return '#,##0.00';
    case 'number':
      return '#,##0.00';
    case 'integer':
      return '#,##0';
    case 'date':
    case 'text':
      return undefined;
  }
}

export async function toXlsx(result: ReportResult): Promise<SerialisedReport> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FleetFlow';
  workbook.created = new Date(result.generatedAt);

  // Excel rejects sheet names over 31 characters, and every report title here is
  // shorter — but the truncation is cheap insurance against a sixth report with
  // a longer name failing at export time rather than at review time.
  const sheet = workbook.addWorksheet(result.title.slice(0, 31));

  sheet.columns = result.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(column.label.length + 2, column.type === 'text' ? 22 : 14),
    style: { numFmt: numberFormat(column) },
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  // Freeze the header so a thousand-row export stays readable while scrolling.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of result.rows) {
    sheet.addRow(toSheetRow(result.columns, row));
  }

  if (result.totals) {
    // A blank row separates the data from the footer, so an autofilter or a
    // pivot over the data range does not pick the totals up as another record.
    sheet.addRow({});
    const totalsRow = sheet.addRow(toSheetRow(result.columns, result.totals));
    totalsRow.font = { bold: true };
  }

  const body = Buffer.from(await workbook.xlsx.writeBuffer());

  return {
    body,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}

/**
 * Cells as native types, not strings.
 *
 * Dates travel as `YYYY-MM-DD` text on the wire; converting them to real Date
 * cells is what lets the recipient sort chronologically and filter by month.
 */
function toSheetRow(columns: ReportColumn[], row: ReportRow): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const column of columns) {
    const value = row[column.key] ?? null;
    if (value === null) {
      output[column.key] = null;
    } else if (column.type === 'date' && typeof value === 'string') {
      output[column.key] = new Date(`${value}T00:00:00.000Z`);
    } else {
      output[column.key] = value;
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * pdfmake needs fonts registered before it will render anything, and shipping
 * none means shipping a renderer that throws on first use. The standard 14 PDF
 * fonts are built into every viewer, so naming Helvetica costs no embedded
 * bytes and no font licence.
 *
 * Registered once at module load: `addFonts` mutates a process-wide singleton,
 * and calling it per export would re-register the same four faces on every
 * request.
 */
pdfmake.addFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

function formatPdfCell(value: ReportCell, column: ReportColumn, currency: string): string {
  if (value === null) return '—';
  if (column.type === 'money' && typeof value === 'number') {
    return `${currency} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (column.type === 'integer' && typeof value === 'number') {
    return value.toLocaleString('en-US');
  }
  return String(value);
}

/** Numbers right, text left — so a column of costs can be scanned down its decimal point. */
function alignmentFor(column: ReportColumn): Alignment {
  return column.type === 'money' || column.type === 'number' || column.type === 'integer'
    ? 'right'
    : 'left';
}

export async function toPdf(result: ReportResult): Promise<SerialisedReport> {
  function cell(value: ReportCell, column: ReportColumn, bold: boolean): TableCell {
    return {
      text: formatPdfCell(value, column, result.currency),
      fontSize: 8,
      bold,
      alignment: alignmentFor(column),
    };
  }

  const header: TableCell[] = result.columns.map((column) => ({
    text: column.label,
    bold: true,
    fontSize: 8,
    alignment: alignmentFor(column),
  }));

  const body: TableCell[][] = result.rows.map((row) =>
    result.columns.map((column) => cell(row[column.key] ?? null, column, false)),
  );

  if (result.totals) {
    const totals = result.totals;
    body.push(result.columns.map((column) => cell(totals[column.key] ?? null, column, true)));
  }

  const definition: TDocumentDefinitions = {
    // Landscape: these tables are wide, and a portrait page turns an
    // eleven-column maintenance history into unreadable slivers.
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [24, 56, 24, 40],
    defaultStyle: { font: 'Helvetica' },

    header: {
      margin: [24, 20, 24, 0],
      columns: [
        { text: 'FleetFlow', bold: true, fontSize: 12, color: '#1d4ed8' },
        { text: result.title, alignment: 'right', fontSize: 10 },
      ],
    },

    // Page numbers matter here: an exported report is printed and passed around,
    // and a stack of unnumbered pages cannot be checked for completeness.
    footer: (currentPage: number, pageCount: number) => ({
      margin: [24, 8, 24, 0],
      columns: [
        { text: describeFilters(result), fontSize: 7, color: '#6b7280' },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: 'right',
          fontSize: 7,
          color: '#6b7280',
        },
      ],
    }),

    content: [
      { text: result.description, fontSize: 9, margin: [0, 0, 0, 2] },
      {
        text: `Generated ${result.generatedAt.replace('T', ' ').slice(0, 19)} UTC · ${result.total} rows`,
        fontSize: 8,
        color: '#6b7280',
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          headerRows: 1,
          // Even columns: computing widths from content would need text metrics,
          // and `*` lets pdfmake distribute the page for us.
          widths: result.columns.map(() => '*'),
          body: [header, ...body],
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };

  return {
    body: await pdfmake.createPdf(definition).getBuffer(),
    contentType: 'application/pdf',
    extension: 'pdf',
  };
}

/** The filters, in the footer, so a printed page still says what it covers. */
function describeFilters(result: ReportResult): string {
  const parts: string[] = [];
  if (result.appliedFilters.from) parts.push(`from ${result.appliedFilters.from}`);
  if (result.appliedFilters.to) parts.push(`to ${result.appliedFilters.to}`);
  if (result.appliedFilters.vehicleId) parts.push('one vehicle');
  if (result.appliedFilters.driverId) parts.push('one driver');
  return parts.length > 0 ? `Filters: ${parts.join(', ')}` : 'No filters — all records';
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function serialise(
  result: ReportResult,
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<SerialisedReport> {
  switch (format) {
    case 'csv':
      return Promise.resolve(toCsv(result));
    case 'xlsx':
      return toXlsx(result);
    case 'pdf':
      return toPdf(result);
  }
}
