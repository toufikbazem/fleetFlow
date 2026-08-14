/**
 * Users data layer — FF-304.
 *
 * Every response type comes from @fleetflow/shared, so a change to the API
 * contract fails `tsc` here rather than showing up as `undefined` on screen.
 */

import type {
  CreateUserRequest,
  InviteResult,
  UpdateUserRequest,
  UserListResponse,
  UserResponse,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const USERS_KEY = ['users'] as const;

export function useUsers(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...USERS_KEY, 'list', params],
    queryFn: () => apiRequest<UserListResponse>('/users', { query: params }),
    // The previous page stays on screen while the next loads, so paging does
    // not flash an empty table.
    placeholderData: (previous) => previous,
  });
}

function invalidate(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: USERS_KEY });
}

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) =>
      apiRequest<InviteResult>('/users', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
      apiRequest<UserResponse>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useSetUserActive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest<UserResponse>(`/users/${id}/${active ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

export function useResendInvitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ invitationSent: boolean }>(`/users/${id}/resend-invitation`, { method: 'POST' }),
    onSuccess: () => invalidate(client),
  });
}
