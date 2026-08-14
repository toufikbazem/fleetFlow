/**
 * Drivers screen — FF-304, DRV-01…04.
 *
 * The same screen serves every role that can reach it, because the API decides
 * what the list contains: a fleet manager sees the whole roster, a driver sees
 * one row — their own. Nothing here branches on role to filter data; it only
 * hides controls the caller could not use anyway.
 */

import type { Driver } from '@fleetflow/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, Mono, PageHeader } from '@/components/ui/primitives';
import { formatDate, formatRelativeDays, fullName } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useDeleteDriver, useDrivers } from './api';
import { DriverFormDialog } from './driver-form';

export function DriversPage() {
  const { can } = useSession();
  const list = useListState({ defaultSort: 'lastName:asc' });
  const { data, isFetching } = useDrivers(list.queryParams);
  const deleteDriver = useDeleteDriver();

  const [editing, setEditing] = useState<Driver | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Driver | undefined>();

  const canCreate = can('drivers', 'create');
  const canUpdate = can('drivers', 'update');
  const canDelete = can('drivers', 'delete');

  const columns: Array<Column<Driver>> = [
    {
      key: 'lastName',
      header: 'Driver',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
            aria-hidden
          >
            {`${row.firstName[0] ?? ''}${row.lastName[0] ?? ''}`.toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{fullName(row)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.userEmail ?? 'No login account'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'licence',
      header: 'Licence',
      hideOnMobile: true,
      render: (row) => (
        <div>
          <Mono>{row.licenceNo}</Mono>
          {row.licenceCategory ? (
            <p className="text-xs text-muted-foreground">Category {row.licenceCategory}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'licenceExpiry',
      header: 'Licence expires',
      sortable: true,
      hideOnMobile: true,
      render: (row) => {
        if (!row.licenceExpiry) return <span className="text-muted-foreground">—</span>;
        const expired = new Date(row.licenceExpiry) < new Date();
        return (
          <div>
            <p className="tabular">{formatDate(row.licenceExpiry)}</p>
            {/* A driver with an expired licence must not be behind a wheel, so
                the relative gap is shown rather than making someone subtract. */}
            <p
              className={
                expired ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'
              }
            >
              {formatRelativeDays(row.licenceExpiry)}
            </p>
          </div>
        );
      },
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) =>
        row.currentAssignments.length === 0 ? (
          <span className="text-muted-foreground">Unassigned</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.currentAssignments.map((assignment) => (
              <Badge key={assignment.vehicleId} tone="outline">
                <Mono>{assignment.plate}</Mono>
              </Badge>
            ))}
          </div>
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canUpdate || canDelete) {
    columns.push({
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {canUpdate ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Edit"
              onClick={(event) => {
                event.stopPropagation();
                setEditing(row);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-4" />
              <span className="sr-only">Edit {fullName(row)}</span>
            </Button>
          ) : null}

          {canDelete ? (
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              title="Delete"
              onClick={(event) => {
                event.stopPropagation();
                setToDelete(row);
              }}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete {fullName(row)}</span>
            </Button>
          ) : null}
        </div>
      ),
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    try {
      await deleteDriver.mutateAsync(toDelete.id);
      reportSuccess(`${fullName(toDelete)} was removed`);
    } catch (error) {
      // The 409 for a driver who still holds a vehicle carries an instruction —
      // "End the assignment first" — so it is shown rather than replaced.
      reportMutationError(error);
      throw error;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Drivers"
        description="The people who drive the fleet. A login account is optional."
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden />
              Add driver
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search drivers"
            placeholder="Search name, licence or phone"
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
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </FilterSelect>

            <FilterSelect
              label="Filter by vehicle"
              value={list.filter('hasVehicle')}
              onChange={(value) => list.setFilter('hasVehicle', value)}
            >
              <option value="">Assigned and unassigned</option>
              <option value="true">Holding a vehicle</option>
              <option value="false">Unassigned</option>
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
        emptyTitle="No drivers match this view"
        emptyDescription="Try clearing the search or filters."
        {...(canCreate
          ? {
              emptyAction: (
                <Button
                  onClick={() => {
                    setEditing(undefined);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden />
                  Add the first driver
                </Button>
              ),
            }
          : {})}
      />

      <DriverFormDialog open={formOpen} onOpenChange={setFormOpen} driver={editing} />

      <ConfirmDialog
        open={toDelete !== undefined}
        onOpenChange={(open) => !open && setToDelete(undefined)}
        title={toDelete ? `Remove ${fullName(toDelete)}?` : ''}
        description="They will no longer appear in FleetFlow. Their past vehicle assignments stay in the history and in reports."
        confirmLabel="Remove driver"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
