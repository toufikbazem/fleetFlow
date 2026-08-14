/**
 * Maintenance — FF-505, MNT-01…07.
 *
 * One screen serving two very different users:
 *
 *   a fleet manager  sees the whole workshop queue and schedules work
 *   a mechanic       sees only the jobs assigned to them, and works through them
 *
 * The difference is not branched here — the API's `W_ASSIGNED` scope decides
 * what comes back. What this file does is default a mechanic's view to their own
 * queue and hide controls they cannot use.
 */

import type { MaintenanceOp } from '@fleetflow/shared';
import { CheckCircle2, Play, Plus, RefreshCw, UserCog, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data-table';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { PageHeader, Spinner } from '@/components/ui/primitives';
import { useVehicles } from '@/features/vehicles/api';
import { formatDate, formatMileage, formatMoney, formatRelativeDays } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useChangeOperationStatus, useOperations, useRunTriggers } from './api';
import {
  AssignMechanicDialog,
  CompleteJobDialog,
  OperationFormDialog,
} from './maintenance-dialogs';

export function MaintenancePage() {
  const { user, can } = useSession();
  const isMechanic = user?.role === 'MECHANIC';

  const list = useListState({ defaultSort: 'dueDate:asc' });
  const { data, isFetching } = useOperations({
    ...list.queryParams,
    // A mechanic lands on their own queue. They can clear the filter, and the
    // API would return the same rows anyway — their scope is already assigned-only.
    ...(isMechanic && list.filter('mine') === undefined ? { mine: 'true' } : {}),
  });

  const { data: vehicles } = useVehicles({ pageSize: 100 });
  const changeStatus = useChangeOperationStatus();
  const runTriggers = useRunTriggers();

  const [createOpen, setCreateOpen] = useState(false);
  const [completing, setCompleting] = useState<MaintenanceOp | undefined>();
  const [assigning, setAssigning] = useState<MaintenanceOp | undefined>();

  const canCreate = can('maintenance', 'create');
  const canUpdate = can('maintenance', 'update');

  async function start(operation: MaintenanceOp): Promise<void> {
    try {
      await changeStatus.mutateAsync({ id: operation.id, body: { status: 'IN_PROGRESS' } });
      reportSuccess('Job started');
    } catch (error) {
      reportMutationError(error);
    }
  }

  async function runEngine(): Promise<void> {
    try {
      const result = await runTriggers.mutateAsync();
      reportSuccess(
        result.operationsCreated === 0 && result.markedOverdue === 0
          ? 'Nothing new is due'
          : `${result.operationsCreated} job(s) scheduled, ${result.markedOverdue} marked overdue`,
      );
    } catch (error) {
      reportMutationError(error);
    }
  }

  const columns: Array<Column<MaintenanceOp>> = [
    {
      key: 'title',
      header: 'Job',
      render: (row) => (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Wrench className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              <Link
                to={`/vehicles/${row.vehicleId}`}
                className="font-mono hover:text-foreground hover:underline"
              >
                {row.plate}
              </Link>
              {' · '}
              {row.make} {row.model}
              {row.planName ? ` · ${row.planName}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Due',
      sortable: true,
      hideOnMobile: true,
      render: (row) => {
        if (!row.dueDate && !row.dueMileage) {
          return <span className="text-muted-foreground">—</span>;
        }
        const late = row.daysUntilDue !== null && row.daysUntilDue < 0;
        return (
          <div>
            {row.dueDate ? (
              <>
                <p className="tabular">{formatDate(row.dueDate)}</p>
                <p
                  className={
                    late ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'
                  }
                >
                  {formatRelativeDays(row.dueDate)}
                </p>
              </>
            ) : null}
            {row.dueMileage ? (
              <p className="text-xs text-muted-foreground">at {formatMileage(row.dueMileage)}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'mechanic',
      header: 'Mechanic',
      hideOnMobile: true,
      render: (row) =>
        row.mechanicName ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      key: 'cost',
      header: 'Cost',
      hideOnMobile: true,
      className: 'text-right',
      render: (row) => <span className="tabular">{formatMoney(row.costTotal)}</span>,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canUpdate) {
    columns.push({
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => {
        if (row.status === 'COMPLETED') return null;
        return (
          <div className="flex justify-end gap-1">
            {row.status !== 'IN_PROGRESS' ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Start work"
                onClick={() => void start(row)}
              >
                <Play className="size-4" />
                <span className="sr-only">Start {row.title}</span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              title="Complete"
              className="hover:bg-success-soft hover:text-success"
              onClick={() => setCompleting(row)}
            >
              <CheckCircle2 className="size-4" />
              <span className="sr-only">Complete {row.title}</span>
            </Button>
            {can('users', 'read') ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Assign a mechanic"
                onClick={() => setAssigning(row)}
              >
                <UserCog className="size-4" />
                <span className="sr-only">Assign {row.title}</span>
              </Button>
            ) : null}
          </div>
        );
      },
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={isMechanic ? 'My jobs' : 'Maintenance'}
        description={
          isMechanic
            ? 'The work assigned to you.'
            : 'Scheduled and unexpected work across the fleet.'
        }
        actions={
          <>
            {canCreate ? (
              <Button
                variant="outline"
                onClick={() => void runEngine()}
                disabled={runTriggers.isPending}
              >
                {runTriggers.isPending ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />}
                Check what is due
              </Button>
            ) : null}
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Add job
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search maintenance"
            placeholder="Search job, plate or vendor"
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
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="OVERDUE">Overdue</option>
              <option value="COMPLETED">Completed</option>
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

            {!isMechanic ? (
              <FilterSelect
                label="Filter by assignment"
                value={list.filter('mine')}
                onChange={(value) => list.setFilter('mine', value)}
              >
                <option value="">Everyone</option>
                <option value="true">Assigned to me</option>
              </FilterSelect>
            ) : null}
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
        emptyTitle={isMechanic ? 'Nothing assigned to you' : 'No jobs match this view'}
        emptyDescription={
          isMechanic
            ? 'Work assigned to you will appear here.'
            : 'Try clearing the filters, or check what is due.'
        }
      />

      <OperationFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        vehicles={vehicles?.data ?? []}
      />

      {completing ? (
        <CompleteJobDialog
          open
          onOpenChange={(open) => !open && setCompleting(undefined)}
          operation={completing}
        />
      ) : null}

      {assigning ? (
        <AssignMechanicDialog
          open
          onOpenChange={(open) => !open && setAssigning(undefined)}
          operation={assigning}
        />
      ) : null}
    </>
  );
}
