/**
 * Maintenance plans — FF-505, MNT-04.
 *
 * The rules that generate work. A plan covering zero vehicles generates nothing
 * and looks identical to one covering forty, so coverage is shown in the list.
 */

import {
  TRIGGER_TYPES,
  createMaintenancePlanRequestSchema,
  type CreateMaintenancePlanRequest,
  type MaintenancePlan,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ConfirmDialog, FormDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { FormActions, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Alert, Badge, Mono, PageHeader, Spinner } from '@/components/ui/primitives';
import { useVehicles, useVehicleTypes } from '@/features/vehicles/api';
import { formatNumber, humanise } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useCreatePlan, useDeletePlan, usePlans } from './api';

export function MaintenancePlansPage() {
  const { can } = useSession();
  const list = useListState();
  const { data, isFetching } = usePlans(list.queryParams);
  const deletePlan = useDeletePlan();

  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<MaintenancePlan | undefined>();

  const canCreate = can('maintenance', 'create');

  const columns: Array<Column<MaintenancePlan>> = [
    {
      key: 'name',
      header: 'Plan',
      render: (row) => (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <CalendarClock className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.vehiclePlate ? (
                <>
                  One vehicle · <Mono>{row.vehiclePlate}</Mono>
                </>
              ) : (
                `Vehicle type · ${row.vehicleTypeName ?? 'unknown'}`
              )}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'trigger',
      header: 'Triggers',
      render: (row) => (
        <div className="text-sm">
          {row.intervalKm ? (
            <p className="tabular">every {formatNumber(row.intervalKm)} km</p>
          ) : null}
          {row.intervalDays ? (
            <p className="tabular">every {formatNumber(row.intervalDays)} days</p>
          ) : null}
          {row.triggerType === 'BOTH' ? (
            <p className="text-xs text-muted-foreground">whichever comes first</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'notice',
      header: 'Announced',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.intervalDays ? `${row.noticeDays} days` : ''}
          {row.intervalDays && row.intervalKm ? ' / ' : ''}
          {row.intervalKm ? `${formatNumber(row.noticeKm)} km` : ''} ahead
        </span>
      ),
    },
    {
      key: 'appliesTo',
      header: 'Covers',
      render: (row) =>
        // A plan covering nothing is the silent failure this column exists for.
        row.appliesTo === 0 ? (
          <Badge dot tone="warning">
            no vehicles
          </Badge>
        ) : (
          <span className="tabular">
            {row.appliesTo} vehicle{row.appliesTo === 1 ? '' : 's'}
          </span>
        ),
    },
    {
      key: 'active',
      header: 'Status',
      render: (row) => (
        <Badge dot tone={row.isActive ? 'success' : 'neutral'}>
          {row.isActive ? 'Active' : 'Paused'}
        </Badge>
      ),
    },
  ];

  if (can('maintenance', 'delete')) {
    columns.push({
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => (
        <Button
          variant="ghost-destructive"
          size="icon-sm"
          title="Delete"
          onClick={() => setToDelete(row)}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete {row.name}</span>
        </Button>
      ),
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    try {
      await deletePlan.mutateAsync(toDelete.id);
      reportSuccess('Plan deleted');
    } catch (error) {
      reportMutationError(error);
      throw error;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Maintenance plans"
        description="Rules that schedule work automatically, by date, by odometer, or both."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add plan
            </Button>
          ) : undefined
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
        emptyTitle="No maintenance plans yet"
        emptyDescription="A plan turns a rule — every 15 000 km, every 6 months — into scheduled jobs."
        {...(canCreate
          ? {
              emptyAction: (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" aria-hidden />
                  Create the first plan
                </Button>
              ),
            }
          : {})}
      />

      <PlanFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={toDelete !== undefined}
        onOpenChange={(open) => !open && setToDelete(undefined)}
        title={toDelete ? `Delete "${toDelete.name}"?` : ''}
        description="Jobs already generated by this plan stay in the history and in cost reports. No new work will be scheduled from it."
        confirmLabel="Delete plan"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function PlanFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPlan = useCreatePlan();
  const { data: types } = useVehicleTypes();
  const { data: vehicles } = useVehicles({ pageSize: 100 });
  const [scope, setScope] = useState<'type' | 'vehicle'>('type');

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMaintenancePlanRequest>({
    resolver: zodResolver(createMaintenancePlanRequestSchema),
    defaultValues: { name: '', triggerType: 'MILEAGE', noticeDays: 14, noticeKm: 500 },
  });

  const triggerType = watch('triggerType');
  const needsDays = triggerType === 'DATE' || triggerType === 'BOTH';
  const needsKm = triggerType === 'MILEAGE' || triggerType === 'BOTH';

  async function onSubmit(values: CreateMaintenancePlanRequest): Promise<void> {
    try {
      await createPlan.mutateAsync({
        name: values.name,
        triggerType: values.triggerType,
        noticeDays: values.noticeDays,
        noticeKm: values.noticeKm,
        ...(values.description ? { description: values.description } : {}),
        ...(scope === 'vehicle'
          ? { vehicleId: values.vehicleId }
          : { vehicleTypeId: values.vehicleTypeId }),
        ...(needsDays && values.intervalDays ? { intervalDays: values.intervalDays } : {}),
        ...(needsKm && values.intervalKm ? { intervalKm: values.intervalKm } : {}),
      });
      reportSuccess('Plan created');
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add maintenance plan"
      description="Jobs are created automatically once a vehicle comes within the notice window."
      size="lg"
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        <FormField name="name" label="Name" error={errors.name?.message} required>
          {(field) => (
            <Input
              {...field}
              {...register('name')}
              autoFocus
              placeholder="Van service — every 15 000 km"
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="scope"
            label="Applies to"
            hint="A plan targets one vehicle or one whole type."
          >
            {(field) => (
              <Select
                {...field}
                value={scope}
                onChange={(event) => setScope(event.target.value as 'type' | 'vehicle')}
              >
                <option value="type">A vehicle type</option>
                <option value="vehicle">One specific vehicle</option>
              </Select>
            )}
          </FormField>

          {scope === 'type' ? (
            <FormField
              name="vehicleTypeId"
              label="Vehicle type"
              error={errors.vehicleTypeId?.message}
              required
            >
              {(field) => (
                <Select {...field} {...register('vehicleTypeId')}>
                  <option value="">Choose a type…</option>
                  {(types?.data ?? []).map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : (
            <FormField name="vehicleId" label="Vehicle" error={errors.vehicleId?.message} required>
              {(field) => (
                <Select {...field} {...register('vehicleId')}>
                  <option value="">Choose a vehicle…</option>
                  {(vehicles?.data ?? []).map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate} · {vehicle.make} {vehicle.model}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
        </div>

        <FormField name="triggerType" label="Triggered by" error={errors.triggerType?.message}>
          {(field) => (
            <Select {...field} {...register('triggerType')}>
              {TRIGGER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value === 'BOTH' ? 'Date or odometer, whichever first' : humanise(value)}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {/* The intervals are grouped in a well: they are the arithmetic of the
            plan, and setting them apart from the identity fields above makes
            the form two decisions rather than eight fields. */}
        <div className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          {needsKm ? (
            <>
              <FormField
                name="intervalKm"
                label="Every (km)"
                error={errors.intervalKm?.message}
                required
              >
                {(field) => <Input {...field} {...register('intervalKm')} type="number" min={1} />}
              </FormField>
              <FormField
                name="noticeKm"
                label="Announce (km ahead)"
                error={errors.noticeKm?.message}
              >
                {(field) => <Input {...field} {...register('noticeKm')} type="number" min={1} />}
              </FormField>
            </>
          ) : null}

          {needsDays ? (
            <>
              <FormField
                name="intervalDays"
                label="Every (days)"
                error={errors.intervalDays?.message}
                required
              >
                {(field) => (
                  <Input {...field} {...register('intervalDays')} type="number" min={1} />
                )}
              </FormField>
              <FormField
                name="noticeDays"
                label="Announce (days ahead)"
                error={errors.noticeDays?.message}
              >
                {(field) => <Input {...field} {...register('noticeDays')} type="number" min={1} />}
              </FormField>
            </>
          ) : null}
        </div>

        <Alert tone="info">
          <span className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Work is scheduled only when someone records an odometer reading or the daily check
              runs. A plan on its own does not create jobs.
            </span>
          </span>
        </Alert>

        <FormField name="description" label="Notes" error={errors.description?.message}>
          {(field) => <Textarea {...field} {...register('description')} rows={2} />}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            Create plan
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}
