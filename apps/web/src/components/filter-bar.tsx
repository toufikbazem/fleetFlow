/**
 * List toolbar — FF-1105.
 *
 * Search and filters had been rebuilt by hand on all seven list screens, and
 * they had drifted: different search placeholders sat at different widths, the
 * icon was inset by a different amount on Users than on Vehicles, and none of
 * them offered a way to see or undo what was being filtered. One toolbar fixes
 * all three, and every list now behaves identically.
 */

import { Search, SlidersHorizontal, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The bar itself.
 *
 * Below `sm` the filters collapse behind a disclosure. A driver looking for a
 * damage report sees a search box and one button rather than four stacked
 * selects filling the screen before a single result — but the disclosure opens
 * automatically when a filter is already set, so an active filter is never
 * hidden from the person it is affecting.
 */
export function FilterBar({
  search,
  filters,
  activeCount = 0,
  onClear,
  className,
}: {
  search?: React.ReactNode;
  filters?: React.ReactNode;
  /** How many filters are set. Drives the badge and the auto-open behaviour. */
  activeCount?: number;
  onClear?: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const open = expanded || activeCount > 0;
  const hasFilters = Boolean(filters);

  return (
    <div className={cn('mb-4 space-y-2', className)}>
      <div className="flex gap-2">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}

        {hasFilters ? (
          <Button
            variant="outline"
            className="shrink-0 sm:hidden"
            aria-expanded={open}
            onClick={() => setExpanded((value) => !value)}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {activeCount > 0 ? (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground">
                {activeCount}
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>

      {hasFilters ? (
        <div className={cn('flex-wrap items-center gap-2 sm:flex', open ? 'flex' : 'hidden')}>
          {filters}

          {activeCount > 0 && onClear ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="size-4" aria-hidden />
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The search field.
 *
 * Uncontrolled, as it was before — the list re-renders on every keystroke and a
 * controlled value fed from the URL would fight the cursor. What is new is the
 * debounce: each keystroke used to write the URL and fire a request, so typing
 * "Renault" cost seven round trips and seven table repaints. A quarter of a
 * second of quiet costs nobody anything and turns that into one.
 */
export function SearchInput({
  defaultValue,
  onSearch,
  placeholder,
  label,
  className,
}: {
  defaultValue?: string | undefined;
  onSearch: (value: string) => void;
  placeholder: string;
  /** The accessible name. Every list screen has more than one text input. */
  label: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = React.useState(!defaultValue);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  // A pending keystroke must not fire after the screen has gone.
  React.useEffect(() => () => clearTimeout(timer.current), []);

  function push(value: string, immediate = false): void {
    clearTimeout(timer.current);
    setEmpty(value === '');
    if (immediate) onSearch(value);
    else timer.current = setTimeout(() => onSearch(value), 250);
  }

  return (
    <div className={cn('relative min-w-0 sm:min-w-64', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={inputRef}
        type="search"
        className="pl-9 pr-9"
        placeholder={placeholder}
        defaultValue={defaultValue ?? ''}
        aria-label={label}
        onChange={(event) => push(event.target.value)}
        // Enter should not wait out the debounce, and it must not submit an
        // enclosing form.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            push(event.currentTarget.value, true);
          }
        }}
      />
      {!empty ? (
        <button
          type="button"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = '';
            push('', true);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
          <span className="sr-only">Clear search</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * A filter select.
 *
 * The label is the accessible name and is not shown: on a filter bar the
 * current *value* already reads as the label ("All statuses", "Under
 * maintenance"), and a visible caption above four selects would double the
 * height of the bar to repeat what it already says.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = Boolean(value);

  return (
    <Select
      aria-label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      className={cn(
        'w-auto min-w-0 max-w-full',
        // A set filter is marked, so "why am I seeing four rows" has an answer
        // visible on the bar rather than only in the URL.
        active && 'border-primary/40 bg-primary-soft font-medium text-primary',
        className,
      )}
    >
      {children}
    </Select>
  );
}
