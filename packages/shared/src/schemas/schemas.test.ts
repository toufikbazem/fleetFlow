/**
 * Contract validation — FF-1206.
 *
 * These schemas are the only thing standing between a request body and the
 * database. Both apps import them, so a rule that quietly loosens here loosens
 * everywhere at once, and the symptom appears somewhere far away — a cost of
 * `1e9`, a page size of 10 000, an email with a trailing space that never
 * matches on login.
 *
 * The cases below are the boundaries and the coercions, not the happy paths.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMaintenanceOpRequestSchema, maintenanceOpListQuerySchema } from './maintenance.js';
import { dateRangeQuerySchema, paginationQuerySchema, parseSort } from './common.js';
import { loginRequestSchema } from './auth.js';
import { createDocumentRequestSchema } from './documents.js';
import { reportExportQuerySchema, reportQuerySchema } from './reports.js';
import { createVehicleRequestSchema } from './vehicles.js';

const VEHICLE_ID = '00000000-0000-4000-8000-000000000301';

describe('pagination', () => {
  it('coerces query strings to numbers', () => {
    // Everything from a URL is a string; without coercion `page` would fail
    // `z.number()` on every request.
    const parsed = paginationQuerySchema.parse({ page: '3', pageSize: '10' });
    expect(parsed).toMatchObject({ page: 3, pageSize: 10 });
  });

  it('defaults sensibly when nothing is supplied', () => {
    expect(paginationQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('caps the page size', () => {
    // An uncapped pageSize is a way to ask for the entire table in one request.
    expect(() => paginationQuerySchema.parse({ pageSize: '5000' })).toThrow();
    expect(paginationQuerySchema.parse({ pageSize: '100' }).pageSize).toBe(100);
  });

  it('rejects a zero or negative page', () => {
    expect(() => paginationQuerySchema.parse({ page: '0' })).toThrow();
    expect(() => paginationQuerySchema.parse({ page: '-1' })).toThrow();
  });

  it('rejects a fractional page', () => {
    expect(() => paginationQuerySchema.parse({ page: '1.5' })).toThrow();
  });

  it('trims free-text search and rejects an empty one', () => {
    expect(paginationQuerySchema.parse({ q: '  volvo  ' }).q).toBe('volvo');
    expect(() => paginationQuerySchema.parse({ q: '   ' })).toThrow();
  });
});

describe('parseSort', () => {
  it('splits a valid directive', () => {
    expect(parseSort('plate:asc')).toEqual({ field: 'plate', direction: 'asc' });
  });

  it('returns undefined for anything malformed rather than throwing', () => {
    // A bad sort must degrade to the default order, not 500 the list endpoint.
    expect(parseSort(undefined)).toBeUndefined();
    expect(parseSort('plate')).toBeUndefined();
    expect(parseSort('plate:sideways')).toBeUndefined();
    expect(parseSort(':asc')).toBeUndefined();
  });
});

describe('date ranges — RPT-07', () => {
  it('accepts a well-ordered range', () => {
    expect(dateRangeQuerySchema.parse({ from: '2026-01-01', to: '2026-12-31' })).toBeTruthy();
  });

  it('rejects a reversed range', () => {
    // Otherwise every report silently returns nothing and looks like no data.
    expect(() => dateRangeQuerySchema.parse({ from: '2026-12-31', to: '2026-01-01' })).toThrow();
  });

  it('accepts a single-day range', () => {
    expect(dateRangeQuerySchema.parse({ from: '2026-08-14', to: '2026-08-14' })).toBeTruthy();
  });

  it('accepts either bound alone', () => {
    expect(dateRangeQuerySchema.parse({ from: '2026-08-14' })).toBeTruthy();
    expect(dateRangeQuerySchema.parse({ to: '2026-08-14' })).toBeTruthy();
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => dateRangeQuerySchema.parse({ from: '14/08/2026' })).toThrow();
    expect(() => dateRangeQuerySchema.parse({ from: '2026-8-14' })).toThrow();
  });
});

describe('money — MNT-05', () => {
  const valid = ['0', '0.00', '12', '250.00', '1234.5', '999999.99'];
  // `''` is deliberately absent from this list. Since FF-1208 a blank cost
  // field means "not supplied", not "invalid" — see the optional-fields suite
  // below. Rejecting it was what made the vehicle and maintenance forms
  // unusable without filling in every box.
  const invalid = ['-1', '1.234', '1e5', '1,234.00', '$250', ' 250 ', 'NaN', 'Infinity'];

  it.each(valid)('accepts %s', (amount) => {
    expect(() =>
      createMaintenanceOpRequestSchema.parse({
        vehicleId: VEHICLE_ID,
        title: 'Oil change',
        costParts: amount,
      }),
    ).not.toThrow();
  });

  it.each(invalid)('rejects %s', (amount) => {
    // Scientific notation and thousands separators are the interesting ones:
    // both parse as numbers in JavaScript and would reach the database as
    // something nobody typed.
    expect(() =>
      createMaintenanceOpRequestSchema.parse({
        vehicleId: VEHICLE_ID,
        title: 'Oil change',
        costParts: amount,
      }),
    ).toThrow();
  });

  it('treats a blank cost as not supplied', () => {
    const parsed = createMaintenanceOpRequestSchema.parse({
      vehicleId: VEHICLE_ID,
      title: 'Oil change',
      costParts: '',
    });
    expect(parsed.costParts).toBeUndefined();
  });

  it('carries money as a string, never a float', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. Costs feed RPT-06's
    // reconciliation, so they travel as decimal strings end to end.
    const parsed = createMaintenanceOpRequestSchema.parse({
      vehicleId: VEHICLE_ID,
      title: 'Oil change',
      costParts: '0.10',
      costLabour: '0.20',
    });
    expect(typeof parsed.costParts).toBe('string');
    expect(parsed.costParts).toBe('0.10');
  });
});

describe('maintenance creation — MNT-02', () => {
  it('requires scheduled work to be due by something', () => {
    // Mirrors the database CHECK. Scheduled work with neither a due date nor a
    // due mileage never appears in an upcoming list and never becomes overdue —
    // it is invisible for ever.
    expect(() =>
      createMaintenanceOpRequestSchema.parse({
        vehicleId: VEHICLE_ID,
        title: 'Annual service',
        kind: 'SCHEDULED',
      }),
    ).toThrow(/due date or a due mileage/);
  });

  it('allows unexpected work with no due date', () => {
    expect(() =>
      createMaintenanceOpRequestSchema.parse({
        vehicleId: VEHICLE_ID,
        title: 'Windscreen chip',
        kind: 'UNEXPECTED',
      }),
    ).not.toThrow();
  });

  it('accepts scheduled work due by mileage alone', () => {
    expect(() =>
      createMaintenanceOpRequestSchema.parse({
        vehicleId: VEHICLE_ID,
        title: 'Service',
        kind: 'SCHEDULED',
        dueMileage: 90_000,
      }),
    ).not.toThrow();
  });

  it('trims the title and rejects a blank one', () => {
    expect(
      createMaintenanceOpRequestSchema.parse({ vehicleId: VEHICLE_ID, title: '  Oil  ' }).title,
    ).toBe('Oil');
    expect(() =>
      createMaintenanceOpRequestSchema.parse({ vehicleId: VEHICLE_ID, title: '   ' }),
    ).toThrow();
  });

  it('rejects a non-uuid vehicle', () => {
    expect(() =>
      createMaintenanceOpRequestSchema.parse({ vehicleId: 'not-a-uuid', title: 'Oil' }),
    ).toThrow();
  });

  it('rejects a negative or zero due mileage', () => {
    for (const dueMileage of [0, -5]) {
      expect(() =>
        createMaintenanceOpRequestSchema.parse({ vehicleId: VEHICLE_ID, title: 'x', dueMileage }),
      ).toThrow();
    }
  });
});

describe('maintenance list filters — DSH drill-through', () => {
  it('turns the boolean-ish strings into booleans', () => {
    expect(maintenanceOpListQuerySchema.parse({ open: 'true' }).open).toBe(true);
    expect(maintenanceOpListQuerySchema.parse({ open: 'false' }).open).toBe(false);
  });

  it('rejects a boolean flag that is not "true" or "false"', () => {
    // `open=1` silently coercing to true is how a filter ends up meaning the
    // opposite of what the URL says.
    expect(() => maintenanceOpListQuerySchema.parse({ open: '1' })).toThrow();
  });

  it('accepts the two due buckets and nothing else', () => {
    expect(maintenanceOpListQuerySchema.parse({ due: 'overdue' }).due).toBe('overdue');
    expect(() => maintenanceOpListQuerySchema.parse({ due: 'later' })).toThrow();
  });
});

describe('report queries — RPT-06, RPT-07', () => {
  it('defaults to the first page', () => {
    expect(reportQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('rejects a reversed range', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-12-01', to: '2026-01-01' })).toThrow();
  });

  it('requires a known export format', () => {
    expect(reportExportQuerySchema.parse({ format: 'xlsx' }).format).toBe('xlsx');
    expect(() => reportExportQuerySchema.parse({ format: 'docx' })).toThrow();
    expect(() => reportExportQuerySchema.parse({})).toThrow();
  });

  it('does not accept a page on an export', () => {
    // An export covers the whole filtered set; accepting a page would make it
    // possible to export rows 26–50 and call it the report.
    const parsed = reportExportQuerySchema.parse({ format: 'csv', page: '3' });
    expect(parsed).not.toHaveProperty('page');
  });
});

/**
 * Blank optional fields — FF-1208, found by the end-to-end suite.
 *
 * An untouched `<input>` submits `''`, not `undefined`, and `.optional()`
 * admits only `undefined`. So a user who filled in the required fields and
 * submitted got a validation error on every field they had deliberately left
 * empty — and coercion made the messages nonsense: "Number must be greater than
 * or equal to 1900" on a blank Year, "Invalid uuid" on an unset Type. Seven of
 * them on the vehicle form alone.
 *
 * This is the regression guard. It matters because the failure is invisible to
 * every layer below the browser: the API is correct in isolation, and each
 * schema reads fine on its own.
 */
describe('optional fields accept a blank submission', () => {
  const cases: Array<[string, z.ZodTypeAny, Record<string, unknown>]> = [
    [
      'vehicle',
      createVehicleRequestSchema,
      {
        plate: 'TEST-1',
        make: 'Renault',
        model: 'Master',
        vin: '',
        year: '',
        vehicleTypeId: '',
        purchaseDate: '',
        purchasePrice: '',
        insuranceValue: '',
        notes: '',
        currentMileage: '',
      },
    ],
    [
      'maintenance operation',
      createMaintenanceOpRequestSchema,
      {
        vehicleId: VEHICLE_ID,
        title: 'Oil change',
        dueDate: '',
        dueMileage: '',
        mechanicId: '',
        costParts: '',
        costLabour: '',
        vendor: '',
      },
    ],
    [
      'document',
      createDocumentRequestSchema,
      {
        vehicleId: VEHICLE_ID,
        documentTypeId: VEHICLE_ID,
        expiryDate: '2027-01-01',
        referenceNo: '',
        issueDate: '',
        noticeDays: '',
        notes: '',
      },
    ],
  ];

  it.each(cases)('%s', (_name, schema, input) => {
    const result = schema.safeParse(input);
    const issues = result.success
      ? ''
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');
    expect(result.success, issues).toBe(true);
  });

  it('treats a blank field as absent rather than as a zero', () => {
    // The distinction matters downstream: `year: 0` would be written to the
    // database, where `undefined` correctly leaves the column null.
    const parsed = createVehicleRequestSchema.parse({
      plate: 'TEST-2',
      make: 'R',
      model: 'M',
      year: '',
    });
    expect(parsed.year).toBeUndefined();
  });

  it('still validates a value that was actually supplied', () => {
    // The fix must not become a way to smuggle rubbish past validation.
    expect(() =>
      createVehicleRequestSchema.parse({ plate: 'T', make: 'R', model: 'M', year: '1800' }),
    ).toThrow();
    expect(() =>
      createVehicleRequestSchema.parse({
        plate: 'T',
        make: 'R',
        model: 'M',
        purchasePrice: 'free',
      }),
    ).toThrow();
    expect(
      createVehicleRequestSchema.parse({ plate: 'T', make: 'R', model: 'M', year: '2024' }).year,
    ).toBe(2024);
  });
});

describe('login — AUTH-01', () => {
  it('normalises an email so a stray space cannot lock someone out', () => {
    const parsed = loginRequestSchema.parse({
      email: '  Admin@Fleet.LOCAL ',
      password: 'x'.repeat(8),
    });
    expect(parsed.email).toBe('admin@fleet.local');
  });

  it('rejects a malformed email', () => {
    expect(() =>
      loginRequestSchema.parse({ email: 'not-an-email', password: 'x'.repeat(8) }),
    ).toThrow();
  });

  it('does not cap the password length in a way that would break a passphrase', () => {
    expect(() =>
      loginRequestSchema.parse({ email: 'a@b.test', password: 'correct horse battery staple' }),
    ).not.toThrow();
  });
});
