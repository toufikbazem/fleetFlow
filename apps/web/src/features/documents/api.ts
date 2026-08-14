/**
 * Documents and attachments data layer — FF-604.
 */

import type {
  Attachment,
  AttachmentEntity,
  AttachmentKind,
  AttachmentListResponse,
  CreateDocumentRequest,
  DocumentListResponse,
  DocumentResponse,
  DocumentTypeListResponse,
  DownloadUrl,
  UpdateDocumentRequest,
  UploadTicket,
} from '@fleetflow/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

const DOCUMENTS_KEY = ['documents'] as const;

function invalidate(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
    // The vehicle overview carries a document-status summary.
    client.invalidateQueries({ queryKey: ['vehicles'] }),
  ]).then(() => undefined);
}

export function useDocuments(params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, 'list', params],
    queryFn: () => apiRequest<DocumentListResponse>('/documents', { query: params }),
    placeholderData: (previous) => previous,
  });
}

export function useDocumentTypes() {
  return useQuery({
    queryKey: ['document-types'],
    queryFn: () => apiRequest<DocumentTypeListResponse>('/document-types'),
    staleTime: 5 * 60_000,
  });
}

export function useCreateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDocumentRequest) =>
      apiRequest<DocumentResponse>('/documents', { method: 'POST', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useUpdateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDocumentRequest }) =>
      apiRequest<DocumentResponse>(`/documents/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(client),
  });
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(client),
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Whether uploading is possible at all.
 *
 * Supabase credentials arrive with FF-004; until then the API reports storage
 * as unconfigured and the UI says so plainly instead of offering a control that
 * fails after the user has chosen a file.
 */
export function useStorageStatus() {
  return useQuery({
    queryKey: ['attachments', 'status'],
    queryFn: () => apiRequest<{ configured: boolean }>('/attachments/status'),
    staleTime: Infinity,
  });
}

export function useAttachments(entityType: AttachmentEntity, entityId: string | undefined) {
  return useQuery({
    queryKey: ['attachments', entityType, entityId],
    queryFn: () =>
      apiRequest<AttachmentListResponse>('/attachments', {
        query: { entityType, entityId },
      }),
    enabled: Boolean(entityId),
  });
}

/**
 * The three-step upload, as one call.
 *
 * Ask for a URL → PUT the file straight to storage → confirm. The middle step
 * deliberately bypasses `apiRequest`: it goes to the storage host, not to
 * FleetFlow, and must not carry the access token.
 */
export function useUploadAttachment() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      entityType: AttachmentEntity;
      entityId: string;
      kind: AttachmentKind;
      file: File;
    }): Promise<Attachment> => {
      const ticket = await apiRequest<UploadTicket>('/attachments/upload-url', {
        method: 'POST',
        body: {
          entityType: input.entityType,
          entityId: input.entityId,
          kind: input.kind,
          fileName: input.file.name,
          mimeType: input.file.type || 'application/octet-stream',
          sizeBytes: input.file.size,
        },
      });

      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': input.file.type || 'application/octet-stream' },
        body: input.file,
      });

      if (!response.ok) {
        throw new Error('The file could not be uploaded. Please try again.');
      }

      const confirmed = await apiRequest<{ attachment: Attachment }>(
        `/attachments/${ticket.attachmentId}/confirm`,
        { method: 'POST' },
      );

      return confirmed.attachment;
    },
    onSuccess: (_data, variables) =>
      client.invalidateQueries({
        queryKey: ['attachments', variables.entityType, variables.entityId],
      }),
  });
}

export function useDeleteAttachment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['attachments'] }),
  });
}

/** Opens the file. The URL is short-lived and issued per request. */
export async function openAttachment(id: string): Promise<void> {
  const { url } = await apiRequest<DownloadUrl>(`/attachments/${id}/download-url`);
  window.open(url, '_blank', 'noopener,noreferrer');
}
