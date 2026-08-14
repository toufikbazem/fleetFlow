/**
 * Dashboard data layer — FF-902.
 */

import type { Dashboard, DashboardCounter } from '@fleetflow/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest<Dashboard>('/dashboard'),
    // The server caches for five minutes and invalidates on writes, so the
    // client refetching sooner just pays a round trip for the same bytes.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * The drill-through URL for a counter.
 *
 * The filter comes from the server — it is the same query that produced the
 * number — so this only supplies the route it belongs to. That split is what
 * stops a counter and the list it opens from disagreeing.
 */
export function drillThrough(path: string, counter: DashboardCounter): string {
  const params = new URLSearchParams(counter.filter);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
