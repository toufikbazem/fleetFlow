/**
 * Notifications data layer — FF-805.
 */

import type {
  NotificationListResponse,
  NotificationRunResult,
  UnreadCountResponse,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const NOTIFICATIONS_KEY = ['notifications'] as const;

function invalidate(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
}

export function useNotifications(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'list', params],
    queryFn: () => apiRequest<NotificationListResponse>('/notifications', { query: params }),
    placeholderData: (previous) => previous,
  });
}

/**
 * The bell badge.
 *
 * Polled rather than pushed. The alternative is a WebSocket, which is a lot of
 * moving parts for a number that changes at most once a day — the rules run on
 * a daily schedule, so a minute of staleness is invisible to the user.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, 'unread'],
    queryFn: () => apiRequest<UnreadCountResponse>('/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<unknown>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidate(client),
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ marked: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => invalidate(client),
  });
}

/** NTF-05 on demand. Safe to call repeatedly — the dedupe key suppresses repeats. */
export function useRunNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<NotificationRunResult>('/notifications/run', { method: 'POST' }),
    onSuccess: () => invalidate(client),
  });
}
