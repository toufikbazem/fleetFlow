/**
 * Vehicles data layer — FF-406.
 */

import type {
  AssignmentResponse,
  ChangeVehicleStatusRequest,
  CreateAssignmentRequest,
  CreateVehicleRequest,
  RecordMileageRequest,
  UpdateVehicleRequest,
  VehicleListResponse,
  VehicleOverview,
  VehicleResponse,
  VehicleTypeListResponse,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const VEHICLES_KEY = ['vehicles'] as const;

/**
 * Anything that changes a vehicle can change its overview, its list row, and —
 * for assignments — the drivers list too. Invalidating all three is cheaper
 * than reasoning about which screens are mounted.
 */
function invalidate(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: VEHICLES_KEY }),
    client.invalidateQueries({ queryKey: ['drivers'] }),
  ]).then(() => undefined);
}

export function useVehicles(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...VEHICLES_KEY, 'list', params],
    queryFn: () => apiRequest<VehicleListResponse>('/vehicles', { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function useVehicleOverview(id: string | undefined) {
  return useQuery({
    queryKey: [...VEHICLES_KEY, 'overview', id],
    queryFn: () => apiRequest<VehicleOverview>(`/vehicles/${id}/overview`),
    enabled: Boolean(id),
  });
}

export function useVehicleTypes() {
  return useQuery({
    queryKey: ['vehicle-types'],
    queryFn: () => apiRequest<VehicleTypeListResponse>('/vehicle-types'),
    // Reference data: it changes when someone edits the catalogue, not hourly.
    staleTime: 5 * 60_000,
  });
}

export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVehicleRequest) =>
      apiRequest<VehicleResponse>('/vehicles', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateVehicleRequest }) =>
      apiRequest<VehicleResponse>(`/vehicles/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useChangeVehicleStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeVehicleStatusRequest }) =>
      apiRequest<VehicleResponse>(`/vehicles/${id}/status`, { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

export function useRecordMileage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecordMileageRequest }) =>
      apiRequest<unknown>(`/vehicles/${id}/mileage`, { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useAssignDriver() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAssignmentRequest) =>
      apiRequest<AssignmentResponse>('/assignments', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useCloseAssignment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<AssignmentResponse>(`/assignments/${id}/close`, { method: 'PATCH', body: {} }),
    onSuccess: () => invalidate(client),
  });
}
