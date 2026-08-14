/**
 * Damages — FF-704, DMG-01…04.
 *
 * Two audiences again: a fleet manager triaging reports, and a driver who only
 * ever files them. The API decides what each sees; this decides what each is
 * offered.
 */

import type { Damage } from '@fleetflow/shared';
import { Archive, Camera, Plus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, FormDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { FileUploadField } from '@/components/file-upload-field';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { FormActions, FormField } from '@/components/form-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Badge, PageHeader, Spinner } from '@/components/ui/primitives';
import { useVehicles } from '@/features/vehicles/api';
import { formatDateTime, formatMoney, humanise } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import {
  useArchiveDamage,
  useChangeDamageStatus,
  useConvertToMaintenance,
  useDamages,
} from './api';
import { ReportDamageDialog } from './report-damage-dialog';

export function DamagesPage() {
  const { user, can } = useSession();
  const isDriver = user?.role === 'DRIVER';

  const list = useListState();
  const { data, isFetching } = useDamages(list.queryParams);
  // A driver reports against the vehicle they hold; everyone else may need any.
  const { data: vehicles } = useVehicles({ pageSize: 100 });

  const changeStatus = useChangeDamageStatus();
  const archive = useArchiveDamage();

  const [reportOpen, setReportOpen] = useState(false);
  const [converting, setConverting] = useState<Damage | undefined>();
  const [photosFor, setPhotosFor] = useState<Damage | undefined>();
  const [rejecting, setRejecting] = useState<Damage | undefined>();

  const canTriage = can('damages', 'update');
  const canReport = can('damages', 'create');

  async function setStatus(
    damage: Damage,
    status: 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED',
  ): Promise<void> {
    try {
      await changeStatus.mutateAsync({ id: damage.id, body: { status } });
      reportSuccess(`Marked ${humanise(status).toLowerCase()}`);
    } catch (error) {
      reportMutationError(error);
      throw error;
    }
  }

  const columns: Array<Column<Damage>> = [
    {
      key: 'description',
      header: 'Report',
      render: (row) => (
        <div className="max-w-md">
          <p className="truncate font-medium">{row.description.split('\n')[0]}</p>
          <p className="truncate text-xs text-muted-foreground">
            <Link
              to={`/vehicles/${row.vehicleId}`}
              className="font-mono hover:text-foreground hover:underline"
            >
              {row.plate}
            </Link>
            {' · '}
            {formatDateTime(row.occurredAt)}
            {row.location ? ` · ${row.location}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'reportedBy',
      header: 'Reported by',
      hideOnMobile: true,
      render: (row) => (
        <div>
          <p className="text-sm">{row.driverName ?? row.reportedByName}</p>
          {row.driverName && row.driverName !== row.reportedByName ? (
            <p className="text-xs text-muted-foreground">filed by {row.reportedByName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (row) => (
        <Badge
          dot
          tone={
            row.severity === 'CRITICAL' ? 'danger' : row.severity === 'HIGH' ? 'warning' : 'neutral'
          }
        >
          {humanise(row.severity)}
        </Badge>
      ),
    },
    {
      key: 'job',
      header: 'Job',
      hideOnMobile: true,
      render: (row) =>
        row.maintenanceOp ? (
          // DMG-02 from this side: the report shows the job it produced.
          <div className="text-sm">
            <p className="truncate">{row.maintenanceOp.title}</p>
            <p className="text-xs text-muted-foreground">
              {humanise(row.maintenanceOp.status)}
              {row.maintenanceOp.completedAt
                ? ` · ${formatMoney(row.maintenanceOp.costTotal)}`
                : ''}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'photos',
      header: 'Photos',
      hideOnMobile: true,
      render: (row) =>
        row.photoCount > 0 ? (
          <Badge tone="outline">
            <Camera className="size-3" aria-hidden />
            {row.photoCount}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  ];

  if (canTriage) {
    columns.push({
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => {
        const closed = row.status === 'RESOLVED' || row.status === 'REJECTED';
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon-sm" title="Photos" onClick={() => setPhotosFor(row)}>
              <Camera className="size-4" />
              <span className="sr-only">Photos for this report</span>
            </Button>

            {!closed && !row.maintenanceOp ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Raise a maintenance job"
                onClick={() => setConverting(row)}
              >
                <Wrench className="size-4" />
                <span className="sr-only">Raise a job from this report</span>
              </Button>
            ) : null}

            {!closed && !row.maintenanceOp ? (
              <Button
                variant="ghost-destructive"
                size="icon-sm"
                title="Reject"
                onClick={() => setRejecting(row)}
              >
                <Archive className="size-4" />
                <span className="sr-only">Reject this report</span>
              </Button>
            ) : null}

            {closed && !row.archivedAt ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Archive"
                onClick={() =>
                  void archive
                    .mutateAsync({ id: row.id, archived: true })
                    .then(() => reportSuccess('Archived'))
                    .catch(reportMutationError)
                }
              >
                <Archive className="size-4" />
                <span className="sr-only">Archive this report</span>
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
        title={isDriver ? 'Problems I have reported' : 'Damage reports'}
        description={
          isDriver
            ? 'Anything you have reported on your vehicle.'
            : 'Reports from drivers, waiting to be triaged.'
        }
        actions={
          canReport ? (
            <Button onClick={() => setReportOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Report a problem
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search damage reports"
            placeholder="Search description, plate or place"
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
              <option value="REPORTED">Reported</option>
              <option value="UNDER_REVIEW">Under review</option>
              <option value="LINKED">Job raised</option>
              <option value="RESOLVED">Resolved</option>
              <option value="REJECTED">Rejected</option>
            </FilterSelect>

            <FilterSelect
              label="Filter by severity"
              value={list.filter('severity')}
              onChange={(value) => list.setFilter('severity', value)}
            >
              <option value="">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </FilterSelect>

            <FilterSelect
              label="Include archived"
              value={list.filter('includeArchived')}
              onChange={(value) => list.setFilter('includeArchived', value)}
            >
              <option value="">Active only</option>
              <option value="true">Include archived</option>
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
        loading={isFetching}
        emptyTitle={isDriver ? 'You have not reported anything' : 'Nothing to triage'}
        emptyDescription={
          isDriver
            ? 'If something is wrong with your vehicle, report it and the fleet manager will see it.'
            : 'Reports from drivers appear here as they are filed.'
        }
      />

      <ReportDamageDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        vehicles={vehicles?.data ?? []}
      />

      {photosFor ? (
        <FormDialog
          open
          onOpenChange={(open) => !open && setPhotosFor(undefined)}
          title={`Photos — ${photosFor.plate}`}
          description={photosFor.description.split('\n')[0]}
        >
          <FileUploadField
            entityType="DAMAGE"
            entityId={photosFor.id}
            kind="PHOTO"
            label="Photos"
            canEdit={canTriage}
          />
        </FormDialog>
      ) : null}

      {converting ? (
        <ConvertDialog damage={converting} onClose={() => setConverting(undefined)} />
      ) : null}

      <ConfirmDialog
        open={rejecting !== undefined}
        onOpenChange={(open) => !open && setRejecting(undefined)}
        title="Reject this report?"
        description="It stays in the record so the driver can see it was seen, but no work will be raised from it. This cannot be undone."
        confirmLabel="Reject"
        destructive
        onConfirm={async () => {
          if (rejecting) await setStatus(rejecting, 'REJECTED');
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DMG-02
// ---------------------------------------------------------------------------

function ConvertDialog({ damage, onClose }: { damage: Damage; onClose: () => void }) {
  const convert = useConvertToMaintenance();
  const [title, setTitle] = useState(
    `Repair: ${damage.description.split('\n')[0]?.slice(0, 100) ?? ''}`,
  );
  const [dueDate, setDueDate] = useState('');

  async function submit(): Promise<void> {
    try {
      const result = await convert.mutateAsync({
        id: damage.id,
        body: { title, ...(dueDate ? { dueDate } : {}) },
      });
      reportSuccess(`Job raised: ${result.operation.title}`);
      onClose();
    } catch (error) {
      reportMutationError(error);
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Raise a maintenance job"
      description={`${damage.plate} · reported ${formatDateTime(damage.occurredAt)}`}
    >
      <div className="space-y-5">
        <Alert tone="info">
          The report and the job stay linked: each one shows the other, and completing the job marks
          the report resolved.
        </Alert>

        <FormField name="title" label="Job title" required>
          {(field) => (
            <Input
              {...field}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          )}
        </FormField>

        <FormField name="dueDate" label="Due date" hint="Optional.">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          )}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={convert.isPending || !title.trim()}>
            {convert.isPending ? <Spinner /> : null}
            Raise job
          </Button>
        </FormActions>
      </div>
    </FormDialog>
  );
}
