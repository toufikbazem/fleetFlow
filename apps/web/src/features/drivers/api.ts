/**
 * Drivers data layer — FF-304.
 */

import type {
  CreateDriverRequest,
  DriverListResponse,
  DriverResponse,
  UpdateDriverRequest,
  UserListResponse,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const DRIVERS_KEY = ['drivers'] as const;

export function useDrivers(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, 'list', params],
    queryFn: () => apiRequest<DriverListResponse>('/drivers', { query: params }),
    placeholderData: (previous) => previous,
  });
}

function invalidate(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: DRIVERS_KEY });
}

export function useCreateDriver() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDriverRequest) =>
      apiRequest<DriverResponse>('/drivers', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateDriver() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDriverRequest }) =>
      apiRequest<DriverResponse>(`/drivers/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteDriver() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/drivers/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

/**
 * Driver-role accounts, for the optional login link (DRV-04).
 *
 * `enabled` is passed by the caller and is false unless the signed-in user may
 * read `users` — which, per the PRD matrix, means administrators only. A fleet
 * manager can create drivers but cannot browse accounts, so the link field is
 * hidden for them rather than showing an empty dropdown or a 403 in the console.
 */
export function useLinkableAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ['users', 'linkable'],
    queryFn: () =>
      apiRequest<UserListResponse>('/users', { query: { role: 'DRIVER', pageSize: 100 } }),
    enabled,
  });
}
