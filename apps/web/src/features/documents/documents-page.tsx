/**
 * Documents — FF-604, DOC-01…06.
 *
 * The screen an administrator opens to answer "is anything about to lapse?".
 * Status is derived server-side against each document's own notice period, so
 * the filter and the badge always agree.
 */

import {
  createDocumentRequestSchema,
  type CreateDocumentRequest,
  type Document,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { ConfirmDialog, FormDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { FileUploadField } from '@/components/file-upload-field';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { FormActions, FormField } from '@/components/form-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, PageHeader, Spinner } from '@/components/ui/primitives';
import { useVehicles } from '@/features/vehicles/api';
import { formatDate, formatRelativeDays } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useCreateDocument, useDeleteDocument, useDocumentTypes, useDocuments } from './api';

export function DocumentsPage() {
  const { can } = useSession();
  const list = useListState({ defaultSort: 'expiryDate:asc' });
  const { data, isFetching } = useDocuments(list.queryParams);
  const { data: types } = useDocumentTypes();
  const { data: vehicles } = useVehicles({ pageSize: 100, includeArchived: 'true' });
  const deleteDocument = useDeleteDocument();

  const [createOpen, setCreateOpen] = useState(false);
  const [attachingTo, setAttachingTo] = useState<Document | undefined>();
  const [toDelete, setToDelete] = useState<Document | undefined>();

  const canCreate = can('documents', 'create');
  const canDelete = can('documents', 'delete');

  const columns: Array<Column<Document>> = [
    {
      key: 'type',
      header: 'Document',
      render: (row) => (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.typeLabel}</p>
            <p className="truncate text-xs text-muted-foreground">
              <Link
                to={`/vehicles/${row.vehicleId}`}
                className="font-mono hover:text-foreground hover:underline"
              >
                {row.plate}
              </Link>
              {row.referenceNo ? ` · ${row.referenceNo}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'expiryDate',
      header: 'Expires',
      sortable: true,
      render: (row) => (
        <div>
          <p className="tabular">{formatDate(row.expiryDate)}</p>
          <p
            className={
              row.status === 'EXPIRED'
                ? 'text-xs font-medium text-destructive'
                : 'text-xs text-muted-foreground'
            }
          >
            {formatRelativeDays(row.expiryDate)}
          </p>
        </div>
      ),
    },
    {
      key: 'notice',
      header: 'Warns',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.effectiveNoticeDays} days ahead
          {/* A per-document override is worth surfacing: it explains why two
              documents expiring the same day have different statuses. */}
          {row.noticeDays !== null ? (
            <Badge tone="accent" className="ml-2">
              custom
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'files',
      header: 'Files',
      hideOnMobile: true,
      render: (row) =>
        row.attachmentCount > 0 ? (
          <Badge tone="outline">
            <Paperclip className="size-3" aria-hidden />
            {row.attachmentCount}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  if (can('documents', 'update') || canDelete) {
    columns.push({
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" title="Files" onClick={() => setAttachingTo(row)}>
            <Paperclip className="size-4" />
            <span className="sr-only">Files for {row.typeLabel}</span>
          </Button>
          {canDelete ? (
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              title="Delete"
              onClick={() => setToDelete(row)}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete {row.typeLabel}</span>
            </Button>
          ) : null}
        </div>
      ),
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    try {
      await deleteDocument.mutateAsync(toDelete.id);
      reportSuccess('Document deleted');
    } catch (error) {
      reportMutationError(error);
      throw error;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Documents"
        description="Insurance, inspections and registrations, with the expiry each one is judged against."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add document
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search documents"
            placeholder="Search plate, reference or type"
            defaultValue={list.q}
            onSearch={list.setSearch}
          />
        }
        filters={
          <>
            <FilterSelect
              label="Filter by status"
              value={list.filter('status')}
              onChange={(value) => list.setFilter('status', value)}
            >
              <option value="">All statuses</option>
              <option value="EXPIRED">Expired</option>
              <option value="EXPIRING_SOON">Expiring soon</option>
              <option value="VALID">Valid</option>
            </FilterSelect>

            <FilterSelect
              label="Filter by type"
              value={list.filter('documentTypeId')}
              onChange={(value) => list.setFilter('documentTypeId', value)}
            >
              <option value="">All types</option>
              {(types?.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Filter by vehicle"
              value={list.filter('vehicleId')}
              onChange={(value) => list.setFilter('vehicleId', value)}
            >
              <option value="">All vehicles</option>
              {(vehicles?.data ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate}
                </option>
              ))}
            </FilterSelect>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        total={data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        loading={isFetching}
        emptyTitle="No documents match this view"
        emptyDescription="Try clearing the search or filters."
      />

      <DocumentFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {attachingTo ? (
        <FormDialog
          open
          onOpenChange={(open) => !open && setAttachingTo(undefined)}
          title={`${attachingTo.typeLabel} — ${attachingTo.plate}`}
          description="Scanned copies of this document."
        >
          <FileUploadField
            entityType="DOCUMENT"
            entityId={attachingTo.id}
            kind="SCAN"
            label="Scans"
            canEdit={can('documents', 'update')}
          />
        </FormDialog>
      ) : null}

      <ConfirmDialog
        open={toDelete !== undefined}
        onOpenChange={(open) => !open && setToDelete(undefined)}
        title={toDelete ? `Delete this ${toDelete.typeLabel.toLowerCase()}?` : ''}
        description="It will no longer appear in FleetFlow or in expiry reminders. The record is retained for audit."
        confirmLabel="Delete document"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function DocumentFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createDocument = useCreateDocument();
  const { data: types } = useDocumentTypes();
  const { data: vehicles } = useVehicles({ pageSize: 100 });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateDocumentRequest>({
    resolver: zodResolver(createDocumentRequestSchema),
    defaultValues: { vehicleId: '', documentTypeId: '', expiryDate: '' },
  });

  async function onSubmit(values: CreateDocumentRequest): Promise<void> {
    try {
      await createDocument.mutateAsync({
        vehicleId: values.vehicleId,
        documentTypeId: values.documentTypeId,
        expiryDate: values.expiryDate,
        ...(values.referenceNo ? { referenceNo: values.referenceNo } : {}),
        ...(values.issueDate ? { issueDate: values.issueDate } : {}),
        ...(values.noticeDays ? { noticeDays: values.noticeDays } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      });
      reportSuccess('Document added');
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add document"
      description="Files can be attached once the document is saved."
      size="lg"
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="vehicleId" label="Vehicle" error={errors.vehicleId?.message} required>
            {(field) => (
              <Select {...field} {...register('vehicleId')} autoFocus>
                <option value="">Choose a vehicle…</option>
                {(vehicles?.data ?? []).map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate} · {vehicle.make} {vehicle.model}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            name="documentTypeId"
            label="Type"
            error={errors.documentTypeId?.message}
            required
          >
            {(field) => (
              <Select {...field} {...register('documentTypeId')}>
                <option value="">Choose a type…</option>
                {(types?.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label} (warns {type.defaultNoticeDays} days ahead)
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField name="referenceNo" label="Reference" error={errors.referenceNo?.message}>
            {(field) => (
              <Input {...field} {...register('referenceNo')} placeholder="INS-2026-0114" />
            )}
          </FormField>

          <FormField name="issueDate" label="Issued on" error={errors.issueDate?.message}>
            {(field) => <Input {...field} {...register('issueDate')} type="date" />}
          </FormField>

          <FormField
            name="expiryDate"
            label="Expires on"
            error={errors.expiryDate?.message}
            required
          >
            {(field) => <Input {...field} {...register('expiryDate')} type="date" />}
          </FormField>

          <FormField
            name="noticeDays"
            label="Warn me (days ahead)"
            hint="Leave blank to use the type's default."
            error={errors.noticeDays?.message}
          >
            {(field) => (
              <Input {...field} {...register('noticeDays')} type="number" min={1} max={365} />
            )}
          </FormField>
        </div>

        <FormField name="notes" label="Notes" error={errors.notes?.message}>
          {(field) => <Textarea {...field} {...register('notes')} rows={2} />}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            Add document
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}
