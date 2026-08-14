/**
 * Monthly maintenance cost — DSH-08.
 *
 * Hand-built rather than pulled from a chart library. This is one bar chart of
 * twelve values; recharts would add roughly 400 kB to a bundle that already
 * warns about its size, and it renders SVG that needs its own accessibility
 * work anyway. Flexbox and a percentage height do the same job.
 *
 * It is a `<table>` underneath, visually hidden, so the figures are readable by
 * a screen reader and copyable — a chart nobody can read the numbers out of is
 * a picture of data, not data.
 *
 * Three things were added when the design system landed, and each answers a
 * question the plain bars could not: gridlines at the quarter marks, so a bar's
 * height is a value rather than a vibe; a peak label, so the scale is stated
 * rather than inferred; and a hover readout above the chart, because a `title`
 * tooltip is invisible on a touch screen and slow everywhere else.
 */

import type { DashboardCost } from '@fleetflow/shared';
import { useState } from 'react';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

function monthLabel(month: string): string {
  const [year, rawMonth] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(rawMonth) - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

export function CostChart({ cost }: { cost: DashboardCost }) {
  // Scale to the tallest bar, not to the total: a fixed scale makes a quiet
  // fleet look like a flat line and a busy one clip.
  const peak = Math.max(...cost.months.map((month) => month.total), 0);
  const [hovered, setHovered] = useState<number | null>(null);

  if (peak === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No completed maintenance in the last {cost.months.length} months.
      </p>
    );
  }

  const last = cost.months.length - 1;
  const active = hovered ?? last;
  const shown = cost.months[active];

  return (
    <>
      {/* The readout. Pinned above the chart rather than floating over it, so
          nothing moves and no bar is ever covered by its own tooltip. */}
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            {shown ? monthLabel(shown.month) : ''}
            {hovered === null ? ' · this month' : ''}
          </p>
          <p className="mt-1 text-xl font-semibold tabular">{formatMoney(shown?.total ?? 0)}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {shown?.operations ?? 0} operation{shown?.operations === 1 ? '' : 's'}
        </p>
      </div>

      <div className="relative" aria-hidden>
        {/* Quarter gridlines, with the peak stated at the top. Four lines is
            enough to read a height off; more would be graph paper. */}
        <div className="pointer-events-none absolute inset-0 bottom-6 flex flex-col justify-between">
          {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
            <div key={fraction} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-right text-2xs tabular text-muted-foreground/70">
                {fraction === 1 || fraction === 0 ? formatMoney(peak * fraction) : ''}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ))}
        </div>

        <div className="relative flex h-44 items-end gap-1 pl-16">
          {cost.months.map((month, index) => {
            const height = (month.total / peak) * 100;
            const isActive = index === active;

            return (
              <div
                key={month.month}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-2"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onTouchStart={() => setHovered(index)}
              >
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cn(
                      'w-full rounded-t-sm transition-colors duration-150',
                      month.total === 0
                        ? 'bg-border'
                        : isActive
                          ? 'bg-primary'
                          : 'bg-primary/55 group-hover:bg-primary/80',
                    )}
                    // A zero month still gets a hairline, so twelve slots are
                    // visibly twelve months rather than a gap that reads as
                    // missing data.
                    style={{ height: `${Math.max(height, month.total > 0 ? 2 : 1)}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'h-6 text-2xs transition-colors',
                    isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {monthLabel(month.month)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <table className="sr-only">
        <caption>Maintenance cost by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Cost</th>
            <th scope="col">Operations</th>
          </tr>
        </thead>
        <tbody>
          {cost.months.map((month) => (
            <tr key={month.month}>
              <th scope="row">{month.month}</th>
              <td>{formatMoney(month.total)}</td>
              <td>{month.operations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
