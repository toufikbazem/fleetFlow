/**
 * Shared list state — FF-1102.
 *
 * Page, sort and search live in the URL rather than in component state. That is
 * a deliberate choice with three consequences a fleet manager will notice:
 * the back button returns to the page they were on, a filtered list can be
 * pasted to a colleague, and a browser reload does not silently reset to page 1.
 *
 * Every list screen in the product uses this, so all of them behave the same.
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface ListState {
  page: number;
  pageSize: number;
  sort: string | undefined;
  q: string | undefined;
  /** Arbitrary per-module filters, read from the same query string. */
  filter: (name: string) => string | undefined;
  setPage: (page: number) => void;
  setSort: (sort: string) => void;
  setSearch: (q: string) => void;
  setFilter: (name: string, value: string | undefined) => void;
  /** How many module filters are set — everything but page, sort and search. */
  activeFilterCount: number;
  /** Drops every module filter at once, leaving the search term in place. */
  clearFilters: () => void;
  /** The object handed straight to the API client's `query` option. */
  queryParams: Record<string, string | number | undefined>;
}

/** The query keys the list machinery owns; anything else is a module filter. */
const RESERVED = ['page', 'pageSize', 'sort', 'q'];

export function useListState(options: { defaultSort?: string; pageSize?: number } = {}): ListState {
  const { defaultSort, pageSize = 25 } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = searchParams.get('sort') ?? defaultSort;
  const q = searchParams.get('q') || undefined;

  const update = useCallback(
    (changes: Record<string, string | undefined>, resetPage = true) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          // Any change to what is being listed invalidates the page number:
          // filtering to three results while on page 4 shows an empty table.
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const queryParams = useMemo(() => {
    const params: Record<string, string | number | undefined> = { page, pageSize };
    if (sort) params['sort'] = sort;
    if (q) params['q'] = q;
    // Anything else in the URL is a module filter; the API validates the names.
    for (const [key, value] of searchParams.entries()) {
      if (!RESERVED.includes(key)) params[key] = value;
    }
    return params;
  }, [page, pageSize, sort, q, searchParams]);

  const activeFilters = useMemo(
    () => [...searchParams.keys()].filter((key) => !RESERVED.includes(key)),
    [searchParams],
  );

  const clearFilters = useCallback(() => {
    update(Object.fromEntries(activeFilters.map((key) => [key, undefined])));
  }, [activeFilters, update]);

  return {
    page,
    pageSize,
    sort,
    q,
    filter: (name) => searchParams.get(name) ?? undefined,
    setPage: (value) => update({ page: String(value) }, false),
    setSort: (value) => update({ sort: value }),
    setSearch: (value) => update({ q: value }),
    setFilter: (name, value) => update({ [name]: value }),
    activeFilterCount: activeFilters.length,
    clearFilters,
    queryParams,
  };
}
