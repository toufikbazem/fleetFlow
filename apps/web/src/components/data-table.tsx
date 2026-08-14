/**
 * Data table — FF-1102 / FF-1105.
 *
 * Every list screen in the product is this component with different columns:
 * vehicles, drivers, maintenance, documents, damages, users, plans. Pagination
 * and sorting are server-driven, because a fleet of 500 vehicles must not be
 * sent to the browser so it can show 25 of them.
 *
 * Deliberately not a generic table library. The needs here are one page size,
 * one sort field, and a click-through row; a library would bring virtualisation,
 * grouping and column resizing that nothing in the PRD asks for.
 *
 * **Below `md` it stops being a table.** A table at 360px is either a sideways
 * scroll or four hidden columns, and a driver at the roadside gets neither: the
 * same rows render as stacked cards, with the columns that were hidden on a
 * narrow table shown as labelled pairs. The data is identical — only the shape
 * changes, and it changes because the shape was the problem.
 *
 * The switch is made in JavaScript rather than by hiding one copy with CSS.
 * Two copies would put every plate, name and status in the document twice —
 * doubling the DOM on the device least able to afford it, and making
 * "is this vehicle on screen" ambiguous to anything that reads the page,
 * automated tests included.
 */

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';

export interface Column<Row> {
  /** Matches a server-side sortable field name when `sortable` is set. */
  key: string;
  header: string;
  /** Cell content. Given the row so it can compose several fields. */
  render: (row: Row) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  /** Hidden in the table below `lg`. Always shown in the mobile card view. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<Row> {
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** `field:asc` / `field:desc`, matching the API's sort parameter. */
  sort?: string | undefined;
  onSortChange?: (sort: string) => void;
  loading?: boolean;
  onRowClick?: (row: Row) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}

/** A column carrying row controls rather than data — rendered apart from the pairs. */
function isActionColumn<Row>(column: Column<Row>): boolean {
  return column.key === 'actions' || column.header === '';
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  sort,
  onSortChange,
  loading = false,
  onRowClick,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  emptyAction,
}: DataTableProps<Row>) {
  // Tailwind's `md`. Named here rather than guessed, so the layout and the
  // breakpoint that switches it cannot drift apart.
  const isWide = useMediaQuery('(min-width: 48rem)');

  const [sortField, sortDirection] = (sort ?? '').split(':');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  // The first load has nothing to keep in place, so it draws the table's shape
  // instead of a spinner in a void. Later loads keep the rows and dim them.
  const firstLoad = loading && rows.length === 0;

  function toggleSort(key: string): void {
    if (!onSortChange) return;
    const next = sortField === key && sortDirection === 'asc' ? 'desc' : 'asc';
    onSortChange(`${key}:${next}`);
  }

  const [primary, ...secondary] = columns;
  const pairColumns = secondary.filter((column) => !isActionColumn(column));
  const actionColumn = columns.find(isActionColumn);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="relative">
        {loading && !firstLoad ? (
          // Overlaid rather than replacing the content: swapping rows for a
          // spinner on every page change makes the layout jump and loses the
          // user's place.
          <div className="absolute inset-0 z-10 bg-card/60 backdrop-blur-[1px]" aria-hidden>
            <div className="sticky top-1/3 mx-auto h-1 w-24 overflow-hidden rounded-full bg-muted">
              <div className="skeleton h-full w-full" />
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------------
            Table — md and up
            --------------------------------------------------------------- */}
        {isWide ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  {columns.map((column) => {
                    const active = sortField === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        className={cn(
                          'px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground',
                          column.hideOnMobile && 'hidden lg:table-cell',
                          column.className,
                        )}
                        aria-sort={
                          active
                            ? sortDirection === 'desc'
                              ? 'descending'
                              : 'ascending'
                            : undefined
                        }
                      >
                        {column.sortable && onSortChange ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className={cn(
                              'group -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground',
                              active && 'text-foreground',
                            )}
                          >
                            {column.header}
                            {active ? (
                              sortDirection === 'desc' ? (
                                <ArrowDown className="size-3 text-primary" aria-hidden />
                              ) : (
                                <ArrowUp className="size-3 text-primary" aria-hidden />
                              )
                            ) : (
                              // Shown only on hover: a permanent arrow on every
                              // sortable column is six arrows saying nothing.
                              <ChevronsUpDown
                                className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                                aria-hidden
                              />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {firstLoad
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index} className="border-b border-border last:border-0">
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-4 py-3.5',
                              column.hideOnMobile && 'hidden lg:table-cell',
                            )}
                          >
                            <Skeleton className={index % 2 === 0 ? 'w-3/4' : 'w-1/2'} />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row) => (
                      <tr
                        key={rowKey(row)}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        // A clickable row is a real control: it needs to be
                        // reachable and operable from the keyboard, not only by
                        // mouse.
                        tabIndex={onRowClick ? 0 : undefined}
                        role={onRowClick ? 'button' : undefined}
                        onKeyDown={
                          onRowClick
                            ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  onRowClick(row);
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          'border-b border-border transition-colors last:border-0',
                          onRowClick
                            ? 'cursor-pointer hover:bg-primary-soft/50 focus-visible:bg-primary-soft/50'
                            : 'hover:bg-surface',
                        )}
                      >
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-4 py-3',
                              column.hideOnMobile && 'hidden lg:table-cell',
                              column.className,
                            )}
                          >
                            {column.render(row)}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ---------------------------------------------------------------
           Cards — below md
           --------------------------------------------------------------- */
          <div>
            {firstLoad ? (
              <ul className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index} className="space-y-2.5 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-5/6" />
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((row) => (
                  <li key={rowKey(row)}>
                    <div
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      role={onRowClick ? 'button' : undefined}
                      onKeyDown={
                        onRowClick
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onRowClick(row);
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'flex flex-col gap-3 p-4 transition-colors',
                        onRowClick && 'cursor-pointer active:bg-primary-soft/50',
                      )}
                    >
                      {primary ? (
                        <div className="min-w-0 text-sm">{primary.render(row)}</div>
                      ) : null}

                      {pairColumns.length > 0 ? (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                          {pairColumns.map((column) => (
                            <div key={column.key} className="min-w-0">
                              <dt className="text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                                {column.header}
                              </dt>
                              <dd className="mt-0.5 truncate text-sm">{column.render(row)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}

                      {actionColumn ? (
                        <div className="flex justify-end border-t border-border pt-2.5">
                          {actionColumn.render(row)}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {rows.length === 0 && !loading ? (
          <EmptyState
            title={emptyTitle}
            {...(emptyDescription ? { description: emptyDescription } : {})}
            {...(emptyAction ? { action: emptyAction } : {})}
          />
        ) : null}
      </div>

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium tabular text-foreground">
              {from}–{to}
            </span>{' '}
            of <span className="font-medium tabular text-foreground">{total}</span>
          </p>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <span className="px-1.5 text-xs tabular text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
