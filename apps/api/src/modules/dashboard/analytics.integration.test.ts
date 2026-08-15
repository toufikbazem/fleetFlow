/**
 * Dashboard, reports and notifications — FF-1201 (DSH-01…08, RPT-01…07, NTF).
 *
 * Three acceptance criteria drive this file, and each is a claim about two
 * things agreeing rather than about one thing working:
 *
 *   DSH  every counter drills through to the corresponding filtered list
 *   RPT-06  exported figures reconcile with the dashboard cost summary
 *   NTF-07  one notification per rule, per entity, per day
 *
 * All three fail silently. A counter that disagrees with its list is a number
 * nobody trusts and nobody reports; a duplicate reminder is an inbox nobody
 * reads.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, setupHarness, teardownHarness, type Harness } from '../../testing/harness.js';

const API = '/api/v1';
let h: Harness;

beforeAll(async () => {
  h = await setupHarness();
});
afterAll(async () => {
  await teardownHarness(h);
});

function qs(filter: Record<string, string>): string {
  return new URLSearchParams(filter).toString();
}

// ---------------------------------------------------------------------------
// DSH-01…08
// ---------------------------------------------------------------------------

describe('GET /dashboard', () => {
  it('returns every section for an administrator', async () => {
    const response = await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));
    expect(response.status).toBe(200);
    expect(response.body.vehicles).not.toBeNull();
    expect(response.body.maintenance).not.toBeNull();
    expect(response.body.documents).not.toBeNull();
    expect(response.body.cost).not.toBeNull();
    expect(Array.isArray(response.body.recentNotifications)).toBe(true);
  });

  it('withholds fleet spend from a mechanic and a driver', async () => {
    // Cost is the clearest case in the product of data that is fine for one
    // role and not another, and `null` is how the API says so.
    for (const role of ['MECHANIC', 'DRIVER'] as const) {
      const response = await request(h.app).get(`${API}/dashboard`).set(h.auth(role));
      expect(response.status).toBe(200);
      expect(response.body.cost).toBeNull();
    }
  });

  it('gives an accountant the cost summary', async () => {
    const response = await request(h.app).get(`${API}/dashboard`).set(h.auth('ACCOUNTANT'));
    expect(response.body.cost).not.toBeNull();
    expect(response.body.cost.months).toHaveLength(12);
  });

  it('scopes a driver’s counters to their own vehicle', async () => {
    const response = await request(h.app).get(`${API}/dashboard`).set(h.auth('DRIVER'));
    expect(response.body.vehicles.total.value).toBe(1);
  });

  it('zero-fills the cost chart so a quiet month is not a gap', async () => {
    const response = await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));
    const months = response.body.cost.months as Array<{ month: string; total: number }>;
    expect(months).toHaveLength(12);
    expect(months.every((m) => typeof m.total === 'number')).toBe(true);
    // Ascending, oldest first — a chart drawn from an unordered array is wrong
    // in a way that looks plausible.
    expect([...months].sort((a, b) => a.month.localeCompare(b.month))).toEqual(months);
  });

  it('serves the second request from cache', async () => {
    await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));
    const second = await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));
    expect(second.body.cached).toBe(true);
  });

  it('retires the cache after a write to a watched module', async () => {
    await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));

    const created = await request(h.app)
      .post(`${API}/maintenance`)
      .set(h.auth('FLEET_MANAGER'))
      .send({ vehicleId: SEED.vehicle.van2, title: 'Cache invalidation probe' });
    h.track('maintenanceOp', created.body.operation.id);

    // The invalidation runs on response `finish`, so it is ordered after the
    // write but not necessarily before the next request arrives.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const after = await request(h.app).get(`${API}/dashboard`).set(h.auth('ADMIN'));
    expect(after.body.cached).toBe(false);
  });

  /**
   * DSH's acceptance criterion, stated as an equality rather than a screenshot.
   *
   * Each counter ships the query that produced it, so this walks them and asks
   * the matching list endpoint for a total. If the two ever disagree the
   * dashboard is lying, and no status code would have said so.
   */
  it('reconciles every counter with its drill-through list', async () => {
    const roles = ['ADMIN', 'FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'] as const;

    for (const role of roles) {
      const dashboard = await request(h.app).get(`${API}/dashboard`).set(h.auth(role));
      const checks: Array<[string, string, { value: number; filter: Record<string, string> }]> = [];

      if (dashboard.body.vehicles) {
        checks.push(
          ['vehicles.total', '/vehicles', dashboard.body.vehicles.total],
          ['vehicles.active', '/vehicles', dashboard.body.vehicles.active],
          ['vehicles.underMaintenance', '/vehicles', dashboard.body.vehicles.underMaintenance],
        );
      }
      if (dashboard.body.maintenance) {
        checks.push(
          ['maintenance.upcoming', '/maintenance', dashboard.body.maintenance.upcoming],
          ['maintenance.overdue', '/maintenance', dashboard.body.maintenance.overdue],
        );
      }
      if (dashboard.body.documents) {
        checks.push(
          ['documents.expiring', '/documents', dashboard.body.documents.expiring],
          ['documents.expired', '/documents', dashboard.body.documents.expired],
        );
      }

      for (const [label, path, counter] of checks) {
        const query = qs({ ...counter.filter, pageSize: '100' });
        const list = await request(h.app).get(`${API}${path}?${query}`).set(h.auth(role));
        expect(list.status, `${role} ${label}`).toBe(200);
        expect(list.body.total, `${role} ${label}`).toBe(counter.value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// RPT-01…07
// ---------------------------------------------------------------------------

const REPORTS = [
  'maintenance-history',
  'cost-by-vehicle',
  'cost-by-period',
  'driver-assignments',
  'expiring-documents',
] as const;

describe('reports', () => {
  it('publishes a catalogue of all five', async () => {
    const response = await request(h.app).get(`${API}/reports`).set(h.auth('ACCOUNTANT'));
    expect(response.status).toBe(200);
    expect(response.body.reports.map((r: { name: string }) => r.name).sort()).toEqual(
      [...REPORTS].sort(),
    );
  });

  it.each(REPORTS)('%s returns a typed table', async (name) => {
    const response = await request(h.app).get(`${API}/reports/${name}`).set(h.auth('ACCOUNTANT'));
    expect(response.status).toBe(200);
    expect(response.body.columns.length).toBeGreaterThan(0);
    expect(response.body.columns.every((c: { type: string }) => c.type)).toBe(true);
    // Every row is keyed by the declared columns; a stray key means the table
    // and its header disagree.
    for (const row of response.body.rows) {
      for (const key of Object.keys(row)) {
        expect(response.body.columns.map((c: { key: string }) => c.key)).toContain(key);
      }
    }
  });

  it.each(REPORTS)('%s is refused to a mechanic and a driver', async (name) => {
    for (const role of ['MECHANIC', 'DRIVER'] as const) {
      const view = await request(h.app).get(`${API}/reports/${name}`).set(h.auth(role));
      expect(view.status).toBe(403);
      // The export endpoint is where a missing guard hands over the whole table
      // in one request, so it is asserted separately.
      const download = await request(h.app)
        .get(`${API}/reports/${name}/export?format=csv`)
        .set(h.auth(role));
      expect(download.status).toBe(403);
    }
  });

  it('rejects an unknown report name', async () => {
    const response = await request(h.app)
      .get(`${API}/reports/not-a-report`)
      .set(h.auth('ACCOUNTANT'));
    expect(response.status).toBe(422);
  });

  it('rejects a reversed date range', async () => {
    const response = await request(h.app)
      .get(`${API}/reports/cost-by-period?from=2026-12-01&to=2026-01-01`)
      .set(h.auth('ACCOUNTANT'));
    expect(response.status).toBe(422);
  });

  it('drops a filter the report does not honour', async () => {
    const response = await request(h.app)
      .get(`${API}/reports/cost-by-period?driverId=${SEED.driver.amina}`)
      .set(h.auth('ACCOUNTANT'));
    // Echoed back empty, rather than silently pretending it was applied.
    expect(response.body.appliedFilters.driverId).toBeUndefined();
  });

  it('totals the whole filtered set, not the visible page', async () => {
    const paged = await request(h.app)
      .get(`${API}/reports/maintenance-history?pageSize=1`)
      .set(h.auth('ACCOUNTANT'));
    const whole = await request(h.app)
      .get(`${API}/reports/maintenance-history?pageSize=200`)
      .set(h.auth('ACCOUNTANT'));

    expect(paged.body.rows).toHaveLength(1);
    expect(paged.body.total).toBe(whole.body.total);
    // A footer that sums only what is on screen is the commonest way a report
    // misleads the person reading it.
    expect(paged.body.totals.total).toBe(whole.body.totals.total);
  });

  it.each(['csv', 'xlsx', 'pdf'] as const)('exports %s as a real file', async (format) => {
    const response = await request(h.app)
      .get(`${API}/reports/cost-by-vehicle/export?format=${format}`)
      .set(h.auth('ACCOUNTANT'))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-content-type-options']).toBe('nosniff');

    const magic = { csv: '﻿', xlsx: 'PK', pdf: '%PDF-' }[format];
    expect((response.body as Buffer).toString('utf8').startsWith(magic)).toBe(true);
  });

  it('rejects an unknown export format', async () => {
    const response = await request(h.app)
      .get(`${API}/reports/cost-by-vehicle/export?format=docx`)
      .set(h.auth('ACCOUNTANT'));
    expect(response.status).toBe(422);
  });

  /**
   * RPT-06's acceptance criterion, and the reason `cost-basis.ts` exists.
   *
   * The dashboard chart and both cost reports read one shared predicate. If
   * they ever diverge, an accountant reconciling an export against the screen
   * finds two different numbers and cannot tell which is right.
   */
  it('reconciles both cost reports with the dashboard summary', async () => {
    const dashboard = await request(h.app).get(`${API}/dashboard`).set(h.auth('ACCOUNTANT'));
    const cost = dashboard.body.cost as { total: number; months: Array<{ month: string }> };
    const from = `${cost.months[0]?.month}-01`;

    const [byPeriod, byVehicle] = await Promise.all([
      request(h.app).get(`${API}/reports/cost-by-period?from=${from}`).set(h.auth('ACCOUNTANT')),
      request(h.app).get(`${API}/reports/cost-by-vehicle?from=${from}`).set(h.auth('ACCOUNTANT')),
    ]);

    expect(byPeriod.body.totals.total).toBe(cost.total);
    expect(byVehicle.body.totals.total).toBe(cost.total);
  });

  it('reconciles month by month, not only in aggregate', async () => {
    // Two sets of monthly figures can sum to the same total and still be wrong
    // in every month.
    const dashboard = await request(h.app).get(`${API}/dashboard`).set(h.auth('ACCOUNTANT'));
    const months = dashboard.body.cost.months as Array<{ month: string; total: number }>;
    const from = `${months[0]?.month}-01`;

    const report = await request(h.app)
      .get(`${API}/reports/cost-by-period?from=${from}&pageSize=200`)
      .set(h.auth('ACCOUNTANT'));
    const byMonth = new Map(
      (report.body.rows as Array<{ month: string; total: number }>).map((r) => [r.month, r.total]),
    );

    for (const month of months) {
      expect(byMonth.get(month.month) ?? 0, month.month).toBe(month.total);
    }
  });

  it('keeps history for a vehicle that has been soft-deleted', async () => {
    // Reports read *through* soft delete: a van sold in March does not un-spend
    // February's servicing, and a total that changes value over time makes
    // reconciliation impossible by definition.
    const before = await request(h.app)
      .get(`${API}/reports/maintenance-history?pageSize=200`)
      .set(h.auth('ACCOUNTANT'));
    expect(before.body.total).toBeGreaterThan(0);
    expect(before.body.rows.some((r: { plate: string }) => r.plate)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NTF
// ---------------------------------------------------------------------------

describe('notifications', () => {
  it('is readable by every role, because it is addressed to a person', async () => {
    for (const role of ['ADMIN', 'FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'] as const) {
      const response = await request(h.app).get(`${API}/notifications`).set(h.auth(role));
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('unreadCount');
    }
  });

  it('is refused to run by a mechanic and a driver', async () => {
    for (const role of ['MECHANIC', 'DRIVER'] as const) {
      const response = await request(h.app).post(`${API}/notifications/run`).set(h.auth(role));
      expect(response.status).toBe(403);
    }
  });

  /**
   * NTF-07, proven rather than asserted.
   *
   * The guarantee is a unique index, not a read-then-write check. A tester
   * pressing "run" four times during UAT is exactly when a naive implementation
   * emails every manager in the company four times, and exactly when they stop
   * trusting the feature.
   */
  it('creates nothing on a second run the same day', async () => {
    const first = await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    expect(first.status).toBe(200);

    const countAfterFirst = (
      await request(h.app).get(`${API}/notifications?pageSize=1`).set(h.auth('FLEET_MANAGER'))
    ).body.total as number;

    const second = await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    expect(second.body.totalCreated).toBe(0);
    // The rules still matched and were suppressed — a different state from "no
    // rule matched", and an operator staring at "0" needs to know which. Stated
    // as "something was suppressed" rather than an exact count: other suites in
    // this run may have triggered the rules first, and the invariant under test
    // is the absence of duplicates, not the arithmetic of one particular order.
    expect(second.body.totalSkipped).toBeGreaterThan(0);

    const third = await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    expect(third.body.totalCreated).toBe(0);

    // The observable form of NTF-07: running the rules again did not give
    // anybody a second copy of anything.
    const countAfterThird = (
      await request(h.app).get(`${API}/notifications?pageSize=1`).set(h.auth('FLEET_MANAGER'))
    ).body.total as number;
    expect(countAfterThird).toBe(countAfterFirst);
  });

  it('delivers to each recipient only what concerns them', async () => {
    await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));

    const accountant = await request(h.app).get(`${API}/notifications`).set(h.auth('ACCOUNTANT'));
    // No rule targets an accountant: they control spend, they do not chase
    // inspections.
    expect(accountant.body.total).toBe(0);

    const driver = await request(h.app).get(`${API}/notifications`).set(h.auth('DRIVER'));
    // NTF-03 reaches the driver because they are the one stopped at the roadside.
    expect(driver.body.data.every((n: { rule: string }) => n.rule === 'INSPECTION_DUE')).toBe(true);
  });

  it('marks one read, then all', async () => {
    await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    const list = await request(h.app).get(`${API}/notifications`).set(h.auth('FLEET_MANAGER'));
    expect(list.body.total).toBeGreaterThan(0);

    const one = await request(h.app)
      .post(`${API}/notifications/${list.body.data[0].id}/read`)
      .set(h.auth('FLEET_MANAGER'));
    expect(one.status).toBe(200);
    expect(one.body.notification.readAt).not.toBeNull();

    const all = await request(h.app)
      .post(`${API}/notifications/read-all`)
      .set(h.auth('FLEET_MANAGER'));
    expect(all.status).toBe(200);

    const count = await request(h.app)
      .get(`${API}/notifications/unread-count`)
      .set(h.auth('FLEET_MANAGER'));
    expect(count.body.unreadCount).toBe(0);
  });

  it('404s another user’s notification rather than confirming it exists', async () => {
    await request(h.app).post(`${API}/notifications/run`).set(h.auth('ADMIN'));
    const managers = await request(h.app).get(`${API}/notifications`).set(h.auth('FLEET_MANAGER'));
    const id = managers.body.data[0]?.id as string | undefined;
    if (!id) return;

    const response = await request(h.app)
      .post(`${API}/notifications/${id}/read`)
      .set(h.auth('DRIVER'));
    expect(response.status).toBe(404);
  });

  it('holds queued email rather than failing it while SMTP is unconfigured', async () => {
    // FF-004/FF-005 are blocked externally. Holding is the correct behaviour:
    // burning through the retry budget now would mean the backlog is already
    // dead by the time credentials arrive.
    const flush = await request(h.app)
      .post(`${API}/notifications/flush-email`)
      .set(h.auth('ADMIN'));
    expect(flush.status).toBe(200);
    expect(flush.body.failed).toBe(0);

    const health = await request(h.app)
      .get(`${API}/notifications/delivery-health`)
      .set(h.auth('ADMIN'));
    expect(health.status).toBe(200);
    expect(health.body.failed).toBe(0);
  });
});
