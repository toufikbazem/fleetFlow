/**
 * Damages data layer — FF-704.
 */

import type {
  ChangeDamageStatusRequest,
  ConvertToMaintenanceRequest,
  CreateDamageRequest,
  DamageListResponse,
  DamageResponse,
  UpdateDamageRequest,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const DAMAGES_KEY = ['damages'] as const;

/** Converting a report creates a job, so maintenance is invalidated too. */
function invalidate(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: DAMAGES_KEY }),
    client.invalidateQueries({ queryKey: ['maintenance'] }),
    client.invalidateQueries({ queryKey: ['vehicles'] }),
  ]).then(() => undefined);
}

export function useDamages(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...DAMAGES_KEY, 'list', params],
    queryFn: () => apiRequest<DamageListResponse>('/damages', { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateDamage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDamageRequest) =>
      apiRequest<DamageResponse>('/damages', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateDamage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDamageRequest }) =>
      apiRequest<DamageResponse>(`/damages/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useChangeDamageStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeDamageStatusRequest }) =>
      apiRequest<DamageResponse>(`/damages/${id}/status`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useArchiveDamage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiRequest<DamageResponse>(`/damages/${id}/${archived ? 'archive' : 'restore'}`, {
        method: 'POST',
      }),
    onSuccess: () => invalidate(client),
  });
}

export function useConvertToMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConvertToMaintenanceRequest }) =>
      apiRequest<{ damage: DamageResponse['damage']; operation: { id: string; title: string } }>(
        `/damages/${id}/convert-to-maintenance`,
        { method: 'POST', body },
      ),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteDamage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/damages/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}
