/**
 * Reports — FF-1003 (RPT-01…07).
 *
 * One screen for all five reports, because the API returns one shape for all
 * five: a list of typed columns and a list of rows. Nothing here knows what
 * "cost by vehicle" is — the picker, the filter bar, the table and the three
 * export buttons are driven entirely by what the server described.
 *
 * That is what makes the RPT-06 acceptance criterion hold. The export buttons
 * send the filter state, never the rendered rows, so the file is recomputed
 * from the same query the table came from — over the whole result set, not the
 * page on screen.
 */

import type {
  ExportFormat,
  ReportCell,
  ReportColumn,
  ReportFilter,
  ReportName,
  ReportResult,
} from '@fleetflow/shared';
import { Download, FileSpreadsheet, FileText, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Spinner,
} from '@/components/ui/primitives';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { reportMutationError } from '@/lib/mutations';
import { cn } from '@/lib/utils';
import { useDrivers } from '@/features/drivers/api';
import { useVehicles } from '@/features/vehicles/api';
import { useExportReport, useReport, useReportCatalogue } from './api';

const PAGE_SIZE = 50;

const EXPORTS: Array<{ format: ExportFormat; label: string; icon: typeof Download }> = [
  { format: 'csv', label: 'CSV', icon: FileText },
  { format: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { format: 'pdf', label: 'PDF', icon: Download },
];

export function ReportsPage() {
  // The filter state lives in the URL, so a filtered report is a shareable link
  // and the back button behaves — both of which matter for something people
  // send to a colleague as "look at this month".
  const [search, setSearch] = useSearchParams();
  const { data: catalogue } = useReportCatalogue();

  const name = (search.get('report') ?? 'maintenance-history') as ReportName;
  const page = Number(search.get('page') ?? '1');

  const filter: ReportFilter = {
    from: search.get('from') ?? undefined,
    to: search.get('to') ?? undefined,
    vehicleId: search.get('vehicleId') ?? undefined,
    driverId: search.get('driverId') ?? undefined,
  };

  const { data, isFetching, isError, error } = useReport(name, filter, page, PAGE_SIZE);
  const exportReport = useExportReport(name, filter);

  const descriptor = catalogue?.reports.find((report) => report.name === name);
  const supported = new Set(descriptor?.supportedFilters ?? []);

  function update(changes: Record<string, string | undefined>): void {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any change to the report or its filters invalidates the page number:
    // page 3 of the old result set is not page 3 of the new one.
    if (!('page' in changes)) next.delete('page');
    setSearch(next, { replace: true });
  }

  async function runExport(format: ExportFormat): Promise<void> {
    try {
      await exportReport.mutateAsync(format);
    } catch (caught) {
      reportMutationError(caught);
    }
  }

  const hasFilters = Boolean(filter.from ?? filter.to ?? filter.vehicleId ?? filter.driverId);

  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Reports"
        description={
          descriptor?.description ?? 'Maintenance, cost, assignment and document reports.'
        }
        actions={EXPORTS.map(({ format, label, icon: Icon }) => (
          <Button
            key={format}
            variant="outline"
            // Exporting nothing produces a file with a header row and no
            // data, which is a confusing thing to receive.
            disabled={exportReport.isPending || (data?.total ?? 0) === 0}
            onClick={() => void runExport(format)}
          >
            {exportReport.isPending && exportReport.variables === format ? (
              <Spinner />
            ) : (
              <Icon className="size-4" aria-hidden />
            )}
            {label}
          </Button>
        ))}
      />

      {/* The controls sit in a well rather than a card: they are the question
          being asked, and the card below is the answer. Two identical surfaces
          would make them read as two results. */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <Field label="Report">
          <Select value={name} onChange={(event) => update({ report: event.target.value })}>
            {(catalogue?.reports ?? []).map((report) => (
              <option key={report.name} value={report.name}>
                {report.title}
              </option>
            ))}
          </Select>
        </Field>

        {/* RPT-07. Only the filters this report honours are offered — showing
            a driver picker that the cost summary ignores would be a control
            that silently does nothing. */}
        {supported.has('from') ? (
          <Field label="From">
            <Input
              type="date"
              value={filter.from ?? ''}
              onChange={(event) => update({ from: event.target.value })}
            />
          </Field>
        ) : null}

        {supported.has('to') ? (
          <Field label="To">
            <Input
              type="date"
              value={filter.to ?? ''}
              onChange={(event) => update({ to: event.target.value })}
            />
          </Field>
        ) : null}

        {supported.has('vehicleId') ? (
          <VehicleFilter
            value={filter.vehicleId}
            onChange={(value) => update({ vehicleId: value })}
          />
        ) : null}

        {supported.has('driverId') ? (
          <DriverFilter value={filter.driverId} onChange={(value) => update({ driverId: value })} />
        ) : null}

        {hasFilters ? (
          <Button
            variant="ghost"
            className="mb-px"
            onClick={() =>
              update({
                from: undefined,
                to: undefined,
                vehicleId: undefined,
                driverId: undefined,
              })
            }
          >
            <RotateCcw className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      {isError ? (
        <Card>
          <ErrorState
            title="The report could not be run"
            {...(error instanceof Error ? { description: error.message } : {})}
          />
        </Card>
      ) : !data ? (
        <LoadingState label="Running the report…" />
      ) : data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No matching records"
            description={
              hasFilters
                ? 'Nothing falls inside these filters. Try widening the date range.'
                : 'There is nothing to report on yet.'
            }
          />
        </Card>
      ) : (
        <ReportTable result={data} isFetching={isFetching} />
      )}

      {data && data.total > PAGE_SIZE ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular">
            Page {page} of {Math.ceil(data.total / PAGE_SIZE)} · {formatNumber(data.total)} rows
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * PAGE_SIZE >= data.total}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function ReportTable({ result, isFetching }: { result: ReportResult; isFetching: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* The wide reports have eleven columns; the scroll belongs to the table,
          never to the page body. */}
      <div className={cn('overflow-x-auto', isFetching && 'opacity-60 transition-opacity')}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              {result.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground',
                    isNumeric(column) ? 'text-right' : 'text-left',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr
                key={index}
                className="border-b border-border transition-colors last:border-0 hover:bg-surface"
              >
                {result.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5',
                      isNumeric(column) && 'text-right tabular-nums',
                    )}
                  >
                    {renderCell(row[column.key] ?? null, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result.totals ? (
            <tfoot>
              {/* Computed by the database over the whole filtered set, not by
                  adding up the visible page. */}
              <tr className="border-t-2 border-border-strong bg-surface font-semibold">
                {result.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5',
                      isNumeric(column) && 'text-right tabular-nums',
                    )}
                  >
                    {renderCell(result.totals?.[column.key] ?? null, column)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function isNumeric(column: ReportColumn): boolean {
  return column.type === 'money' || column.type === 'number' || column.type === 'integer';
}

function renderCell(value: ReportCell, column: ReportColumn): React.ReactNode {
  // An empty cell, not "0" or "null": no end date on an open assignment means
  // it is still running, which is not the same as a zero.
  if (value === null || value === '') return <span className="text-muted-foreground">—</span>;

  switch (column.type) {
    case 'money':
      return typeof value === 'number' ? formatMoney(value) : value;
    case 'integer':
    case 'number':
      return typeof value === 'number' ? formatNumber(value) : value;
    case 'date':
      return typeof value === 'string' ? formatDate(value) : value;
    case 'text':
      return value;
  }
}

// ---------------------------------------------------------------------------
// Filter controls
// ---------------------------------------------------------------------------

/**
 * A labelled filter control.
 *
 * The label is associated by `htmlFor`/`id` rather than by wrapping, matching
 * `FormField` and the `aria-label` convention on the other list screens. An
 * implicitly wrapped control is announced inconsistently across screen readers
 * and is not reliably addressable by its label, which is also why it was hard
 * to drive from the end-to-end suite.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = `report-filter-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1.5 sm:flex-none">
      <label
        htmlFor={id}
        className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
      >
        {label}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}

function VehicleFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  // Archived vehicles are included: a report about last year's costs is often
  // precisely about a vehicle that has since left the fleet.
  const { data } = useVehicles({ pageSize: 100, includeArchived: 'true' });

  return (
    <Field label="Vehicle">
      <Select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">All vehicles</option>
        {(data?.data ?? []).map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.plate} — {vehicle.make} {vehicle.model}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function DriverFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const { data } = useDrivers({ pageSize: 100 });

  return (
    <Field label="Driver">
      <Select value={value ?? ''} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">All drivers</option>
        {(data?.data ?? []).map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.firstName} {driver.lastName}
          </option>
        ))}
      </Select>
    </Field>
  );
}
