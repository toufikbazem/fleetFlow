/**
 * Maintenance data layer — FF-505.
 */

import type {
  AssignMechanicRequest,
  ChangeMaintenanceStatusRequest,
  CreateMaintenanceOpRequest,
  CreateMaintenancePlanRequest,
  MaintenanceOpListResponse,
  MaintenanceOpResponse,
  MaintenancePlanListResponse,
  MaintenancePlanResponse,
  TriggerRunResult,
  UpdateMaintenanceOpRequest,
  UpdateMaintenancePlanRequest,
  UserListResponse,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const MAINTENANCE_KEY = ['maintenance'] as const;
const PLANS_KEY = ['maintenance-plans'] as const;

/** Completing a job can move the odometer, so vehicles are invalidated too. */
function invalidate(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: MAINTENANCE_KEY }),
    client.invalidateQueries({ queryKey: PLANS_KEY }),
    client.invalidateQueries({ queryKey: ['vehicles'] }),
  ]).then(() => undefined);
}

export function useOperations(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, 'list', params],
    queryFn: () => apiRequest<MaintenanceOpListResponse>('/maintenance', { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function usePlans(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...PLANS_KEY, 'list', params],
    queryFn: () => apiRequest<MaintenancePlanListResponse>('/maintenance-plans', { query: params }),
    placeholderData: (previous) => previous,
  });
}

/** Mechanics, for the assignment dropdown. Only administrators can list users. */
export function useMechanics(enabled: boolean) {
  return useQuery({
    queryKey: ['users', 'mechanics'],
    queryFn: () =>
      apiRequest<UserListResponse>('/users', { query: { role: 'MECHANIC', pageSize: 100 } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCreateOperation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMaintenanceOpRequest) =>
      apiRequest<MaintenanceOpResponse>('/maintenance', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateOperation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMaintenanceOpRequest }) =>
      apiRequest<MaintenanceOpResponse>(`/maintenance/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useChangeOperationStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeMaintenanceStatusRequest }) =>
      apiRequest<MaintenanceOpResponse>(`/maintenance/${id}/status`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useAssignMechanic() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignMechanicRequest }) =>
      apiRequest<MaintenanceOpResponse>(`/maintenance/${id}/assign`, { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteOperation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/maintenance/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

export function useCreatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMaintenancePlanRequest) =>
      apiRequest<MaintenancePlanResponse>('/maintenance-plans', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdatePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMaintenancePlanRequest }) =>
      apiRequest<MaintenancePlanResponse>(`/maintenance-plans/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeletePlan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/maintenance-plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

/** FF-503 on demand. Safe to call repeatedly — the engine is idempotent. */
export function useRunTriggers() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<TriggerRunResult>('/maintenance/run-triggers', { method: 'POST' }),
    onSuccess: () => invalidate(client),
  });
}
