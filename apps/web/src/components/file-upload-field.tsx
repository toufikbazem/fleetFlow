/**
 * File upload — FF-1102, driving FF-601's pipeline.
 *
 * Shared by document scans, maintenance invoices and damage photos. The upload
 * itself goes straight to storage; this component only orchestrates the three
 * steps and reports what happened.
 */

import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AttachmentEntity,
  type AttachmentKind,
} from '@fleetflow/shared';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Spinner } from '@/components/ui/primitives';
import {
  openAttachment,
  useAttachments,
  useDeleteAttachment,
  useStorageStatus,
  useUploadAttachment,
} from '@/features/documents/api';
import { formatDateTime } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileUploadField({
  entityType,
  entityId,
  kind = 'SCAN',
  label = 'Files',
  canEdit = true,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  kind?: AttachmentKind;
  label?: string;
  canEdit?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: storage } = useStorageStatus();
  const { data: attachments, isLoading } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment();

  const configured = storage?.configured ?? false;

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    setUploading(true);

    try {
      // Sequential rather than parallel: each upload consumes a signed URL and
      // a confirmation round trip, and a browser firing ten at once against a
      // storage rate limit fails in a way the user cannot interpret.
      for (const file of Array.from(files)) {
        await upload.mutateAsync({ entityType, entityId, kind, file });
      }
      reportSuccess(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
    } catch (error) {
      reportMutationError(error);
    } finally {
      setUploading(false);
      // Cleared so choosing the same file again still fires a change event.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {label}
        </p>
        {canEdit && configured ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <Upload className="size-4" aria-hidden />}
            Upload
          </Button>
        ) : null}
      </div>

      {!configured ? (
        // The honest message, rather than a button that 503s once a file is
        // chosen. Storage is unconfigured until FF-004 supplies credentials.
        <Alert tone="info">
          File storage is not configured yet, so scans and photos cannot be uploaded. Everything
          else on this record works normally.
        </Alert>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : (attachments?.data.length ?? 0) === 0 ? (
        configured ? (
          <EmptyState
            icon={Upload}
            className="rounded-xl border border-dashed border-border py-10"
            title="No files yet"
            description={`Up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB each. PDF, JPEG, PNG, WebP or HEIC.`}
          />
        ) : null
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {(attachments?.data ?? []).map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-surface"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(attachment.sizeBytes)} · {formatDateTime(attachment.createdAt)}
                  {attachment.uploadedByName ? ` · ${attachment.uploadedByName}` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Open"
                onClick={() => void openAttachment(attachment.id).catch(reportMutationError)}
              >
                <Download className="size-4" />
                <span className="sr-only">Open {attachment.fileName}</span>
              </Button>
              {canEdit ? (
                <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  title="Delete"
                  onClick={() =>
                    void remove
                      .mutateAsync(attachment.id)
                      .then(() => reportSuccess('File deleted'))
                      .catch(reportMutationError)
                  }
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">Delete {attachment.fileName}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
