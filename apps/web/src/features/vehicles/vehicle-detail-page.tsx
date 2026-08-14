/**
 * Vehicle detail — FF-406, VEH-02.
 *
 * Acceptance: "The detail page loads all four aggregate sections without a
 * separate navigation step." One request returns all of it, and the tabs switch
 * between sections already in hand — so they can never show data from four
 * different moments.
 *
 * The screen is built as three bands: who and what this vehicle is, the five
 * numbers a fleet manager checks first, and then the detail behind them. The
 * actions live in the identity band rather than scattered down the page,
 * because "record the odometer" is a thing you do *to the vehicle*, not to the
 * section you happen to be looking at.
 */

import type { VehicleOverview } from '@fleetflow/shared';
import {
  Archive,
  ArrowLeft,
  FileText,
  Gauge,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
  Wrench,
} from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Badge,
  Card,
  CountPill,
  EmptyState,
  ErrorState,
  LoadingState,
  Mono,
  SectionHeader,
} from '@/components/ui/primitives';
import { useDrivers } from '@/features/drivers/api';
import {
  formatDate,
  formatDateTime,
  formatMileage,
  formatMoney,
  formatRelativeDays,
  humanise,
} from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  useChangeVehicleStatus,
  useCloseAssignment,
  useDeleteVehicle,
  useVehicleOverview,
} from './api';
import { AssignDriverDialog, MileageDialog, VehicleFormDialog } from './vehicle-dialogs';

type Tab = 'drivers' | 'maintenance' | 'history' | 'documents';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'drivers', label: 'Drivers' },
  { value: 'maintenance', label: 'Upcoming' },
  { value: 'history', label: 'History' },
  { value: 'documents', label: 'Documents' },
];

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, isLoading, isError } = useVehicleOverview(id);

  const [tab, setTab] = useState<Tab>('drivers');
  const [editOpen, setEditOpen] = useState(false);
  const [mileageOpen, setMileageOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'restore' | 'delete' | undefined>();

  // Only fetched when the assign dialog can actually be opened.
  const canUpdate = can('vehicles', 'update');
  const { data: drivers } = useDrivers(canUpdate ? { pageSize: 100, status: 'ACTIVE' } : {});

  const changeStatus = useChangeVehicleStatus();
  const deleteVehicle = useDeleteVehicle();
  const closeAssignment = useCloseAssignment();

  if (isLoading) return <LoadingState label="Loading vehicle…" />;

  if (isError || !data) {
    return (
      <Card>
        <ErrorState
          title="This vehicle could not be loaded"
          description="It may have been deleted, or you may not have access to it."
          action={
            <Button asChild variant="outline">
              <Link to="/vehicles">Back to vehicles</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  const { vehicle, totals } = data;

  const counts: Record<Tab, number> = {
    drivers: data.driverHistory.length,
    maintenance: data.upcomingMaintenance.length,
    history: data.maintenanceHistory.length,
    documents: data.documents.length,
  };

  async function runConfirm(): Promise<void> {
    if (!confirm || !id) return;
    try {
      if (confirm === 'delete') {
        await deleteVehicle.mutateAsync(id);
        reportSuccess(`${vehicle.plate} was deleted`);
        navigate('/vehicles');
      } else {
        await changeStatus.mutateAsync({
          id,
          body: { status: confirm === 'archive' ? 'ARCHIVED' : 'ACTIVE' },
        });
        reportSuccess(confirm === 'archive' ? 'Vehicle archived' : 'Vehicle returned to service');
      }
    } catch (error) {
      // 409s here carry instructions — "End the current driver assignment
      // before archiving" — so they are shown as written.
      reportMutationError(error);
      throw error;
    }
  }

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/vehicles">
          <ArrowLeft className="size-4" aria-hidden />
          All vehicles
        </Link>
      </Button>

      {/* --- Identity ------------------------------------------------------ */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Gauge className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">
                {vehicle.plate}
              </h1>
              <StatusBadge status={vehicle.status} />
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {vehicle.make} {vehicle.model}
              {vehicle.year ? ` · ${vehicle.year}` : ''}
              {vehicle.vehicleTypeName ? ` · ${vehicle.vehicleTypeName}` : ''}
              {vehicle.vin ? (
                <>
                  {' · VIN '}
                  <Mono>{vehicle.vin}</Mono>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {canUpdate ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMileageOpen(true)}>
              <Gauge className="size-4" aria-hidden />
              Record odometer
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
              <UserPlus className="size-4" aria-hidden />
              {vehicle.currentDriver ? 'Hand over' : 'Assign driver'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
            {vehicle.status === 'ARCHIVED' ? (
              <Button variant="outline" size="sm" onClick={() => setConfirm('restore')}>
                <RotateCcw className="size-4" aria-hidden />
                Return to service
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirm('archive')}>
                <Archive className="size-4" aria-hidden />
                Archive
              </Button>
            )}
            {can('vehicles', 'delete') ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:border-destructive/40 hover:bg-destructive-soft"
                onClick={() => setConfirm('delete')}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {vehicle.status === 'ARCHIVED' ? (
        <Alert tone="info" className="mb-5">
          This vehicle is archived. It stays in reports and history but is hidden from operational
          lists.
        </Alert>
      ) : null}

      {/* --- Summary strip — the numbers a fleet manager checks first ------ */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Odometer" value={formatMileage(vehicle.currentMileage)} />
        <Stat
          label="Driver"
          value={
            vehicle.currentDriver
              ? `${vehicle.currentDriver.firstName} ${vehicle.currentDriver.lastName}`
              : '—'
          }
        />
        <Stat
          label="Open jobs"
          value={String(totals.openJobs)}
          tone={totals.openJobs > 0 ? 'warning' : undefined}
        />
        <Stat
          label="Docs needing attention"
          value={String(totals.expiringDocuments)}
          tone={totals.expiringDocuments > 0 ? 'danger' : undefined}
        />
        <Stat label="Lifetime maintenance" value={formatMoney(totals.maintenanceCost)} />
      </div>

      {/* --- Detail -------------------------------------------------------- */}
      <Tabs current={tab} onSelect={setTab} counts={counts} />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="animate-fade-in"
      >
        {tab === 'drivers' ? (
          <DriverHistory
            data={data}
            onClose={async (assignmentId) => {
              try {
                await closeAssignment.mutateAsync(assignmentId);
                reportSuccess('Assignment ended');
              } catch (error) {
                reportMutationError(error);
              }
            }}
            canUpdate={canUpdate}
          />
        ) : null}
        {tab === 'maintenance' ? (
          <MaintenanceList rows={data.upcomingMaintenance} upcoming />
        ) : null}
        {tab === 'history' ? (
          <MaintenanceList rows={data.maintenanceHistory} totalCost={totals.maintenanceCost} />
        ) : null}
        {tab === 'documents' ? <DocumentList rows={data.documents} /> : null}
      </div>

      <VehicleFormDialog open={editOpen} onOpenChange={setEditOpen} vehicle={vehicle} />
      <MileageDialog open={mileageOpen} onOpenChange={setMileageOpen} vehicle={vehicle} />
      <AssignDriverDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        vehicle={vehicle}
        drivers={drivers?.data ?? []}
      />

      <ConfirmDialog
        open={confirm !== undefined}
        onOpenChange={(open) => !open && setConfirm(undefined)}
        title={
          confirm === 'delete'
            ? `Delete ${vehicle.plate}?`
            : confirm === 'archive'
              ? `Archive ${vehicle.plate}?`
              : `Return ${vehicle.plate} to service?`
        }
        description={
          confirm === 'delete'
            ? 'It will no longer appear in FleetFlow. Its maintenance costs, documents and damage reports stay in the history and in reports.'
            : confirm === 'archive'
              ? 'It will be hidden from operational lists but stays in reports and history. You can return it to service later.'
              : 'It will appear in operational lists again and can be assigned to a driver.'
        }
        confirmLabel={
          confirm === 'delete' ? 'Delete' : confirm === 'archive' ? 'Archive' : 'Return to service'
        }
        destructive={confirm === 'delete' || confirm === 'archive'}
        onConfirm={runConfirm}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'warning' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-xs">
      <p className="truncate text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <div
        className={cn(
          'mt-1.5 truncate text-lg font-semibold tabular',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The tab strip.
 *
 * Arrow keys move between tabs and the inactive ones leave the tab order, which
 * is what the ARIA tabs pattern asks for and what a keyboard user expects: one
 * stop for the whole strip, not four.
 */
function Tabs({
  current,
  onSelect,
  counts,
}: {
  current: Tab;
  onSelect: (tab: Tab) => void;
  counts: Record<Tab, number>;
}) {
  function onKeyDown(event: React.KeyboardEvent): void {
    const index = TABS.findIndex((tab) => tab.value === current);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    if (next) onSelect(next.value);
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
    >
      {TABS.map((tab) => {
        const active = current === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`tab-${tab.value}`}
            aria-selected={active}
            aria-controls={`panel-${tab.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {tab.label}
            <CountPill value={counts[tab.value]} active={active} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DriverHistory({
  data,
  onClose,
  canUpdate,
}: {
  data: VehicleOverview;
  onClose: (assignmentId: string) => Promise<void>;
  canUpdate: boolean;
}) {
  if (data.driverHistory.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={UserPlus}
          title="No driver has been assigned yet"
          description="Assign a driver to start the history for this vehicle."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {data.driverHistory.map((assignment) => (
          <li
            key={assignment.id}
            className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{assignment.driverName}</p>
              <p className="text-xs tabular text-muted-foreground">
                {formatDate(assignment.startDate)} →{' '}
                {assignment.endDate ? formatDate(assignment.endDate) : 'present'}
              </p>
            </div>
            {assignment.endDate === null ? (
              <>
                <Badge dot tone="success">
                  Current
                </Badge>
                {canUpdate ? (
                  <Button variant="outline" size="sm" onClick={() => void onClose(assignment.id)}>
                    End assignment
                  </Button>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MaintenanceList({
  rows,
  upcoming = false,
  totalCost,
}: {
  rows: VehicleOverview['upcomingMaintenance'];
  upcoming?: boolean;
  totalCost?: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Wrench}
          title={upcoming ? 'Nothing scheduled' : 'No completed work yet'}
          {...(upcoming
            ? { description: 'Work appears here as plans fall due or jobs are raised by hand.' }
            : {})}
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {totalCost ? (
        <SectionHeader
          icon={Wrench}
          title="Completed work"
          description={`${formatMoney(totalCost)} spent on this vehicle to date`}
          className="border-b border-border"
        />
      ) : null}
      <ul className="divide-y divide-border">
        {rows.map((op) => (
          <li
            key={op.id}
            className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{op.title}</p>
              <p className="text-xs text-muted-foreground">
                {op.completedAt
                  ? `Completed ${formatDate(op.completedAt)}`
                  : op.dueDate
                    ? `Due ${formatDate(op.dueDate)} · ${formatRelativeDays(op.dueDate)}`
                    : op.dueMileage
                      ? `Due at ${formatMileage(op.dueMileage)}`
                      : 'No due date'}
                {op.mechanicName ? ` · ${op.mechanicName}` : ''}
              </p>
            </div>
            <span className="text-sm tabular">{formatMoney(op.costTotal)}</span>
            <StatusBadge status={op.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DocumentList({ rows }: { rows: VehicleOverview['documents'] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={FileText}
          title="No documents recorded"
          description="Insurance, inspection and registration documents for this vehicle appear here."
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {rows.map((doc) => (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{doc.typeLabel}</p>
              <p className="text-xs text-muted-foreground">
                {doc.referenceNo ? (
                  <>
                    <Mono>{doc.referenceNo}</Mono>
                    {' · '}
                  </>
                ) : null}
                Expires {formatDate(doc.expiryDate)} · {formatRelativeDays(doc.expiryDate)}
              </p>
            </div>
            <StatusBadge status={doc.status} label={humanise(doc.status)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Kept for the mileage tab when the detail page grows one (FF-403 history). */
export function MileageList({ rows }: { rows: VehicleOverview['recentMileage'] }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((reading) => (
        <li key={reading.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
          <span className="font-medium tabular">{formatMileage(reading.mileage)}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(reading.recordedAt)}
            {reading.recordedByName ? ` · ${reading.recordedByName}` : ''}
            {reading.note ? ` · ${reading.note}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
