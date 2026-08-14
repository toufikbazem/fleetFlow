/**
 * Maintenance dialogs — FF-505.
 */

import {
  MAINTENANCE_KINDS,
  createMaintenanceOpRequestSchema,
  type CreateMaintenanceOpRequest,
  type MaintenanceOp,
  type Vehicle,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormDialog } from '@/components/confirm-dialog';
import { FormActions, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Alert, Spinner } from '@/components/ui/primitives';
import { formatMileage, formatMoney, humanise } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import {
  useAssignMechanic,
  useChangeOperationStatus,
  useCreateOperation,
  useMechanics,
} from './api';

// ---------------------------------------------------------------------------
// Create a job — MNT-01
// ---------------------------------------------------------------------------

export function OperationFormDialog({
  open,
  onOpenChange,
  vehicles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicles: Vehicle[];
}) {
  const { can } = useSession();
  const createOperation = useCreateOperation();
  const { data: mechanics } = useMechanics(can('users', 'read'));

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMaintenanceOpRequest>({
    resolver: zodResolver(createMaintenanceOpRequestSchema),
    defaultValues: { vehicleId: '', title: '', kind: 'UNEXPECTED' },
  });

  const kind = watch('kind');

  async function onSubmit(values: CreateMaintenanceOpRequest): Promise<void> {
    try {
      await createOperation.mutateAsync({
        vehicleId: values.vehicleId,
        title: values.title,
        kind: values.kind,
        ...(values.description ? { description: values.description } : {}),
        ...(values.dueDate ? { dueDate: values.dueDate } : {}),
        ...(values.dueMileage ? { dueMileage: values.dueMileage } : {}),
        ...(values.mechanicId ? { mechanicId: values.mechanicId } : {}),
        ...(values.vendor ? { vendor: values.vendor } : {}),
      });
      reportSuccess('Job created');
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add maintenance job"
      description="Unexpected work needs no due date. Scheduled work does — otherwise it never becomes overdue."
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        <FormField name="vehicleId" label="Vehicle" error={errors.vehicleId?.message} required>
          {(field) => (
            <Select {...field} {...register('vehicleId')}>
              <option value="">Choose a vehicle…</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate} · {vehicle.make} {vehicle.model}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField name="title" label="What needs doing" error={errors.title?.message} required>
          {(field) => (
            <Input {...field} {...register('title')} placeholder="Brake pads, front axle" />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="kind" label="Kind" error={errors.kind?.message}>
            {(field) => (
              <Select {...field} {...register('kind')}>
                {MAINTENANCE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {humanise(value)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {can('users', 'read') ? (
            <FormField name="mechanicId" label="Mechanic" error={errors.mechanicId?.message}>
              {(field) => (
                <Select {...field} {...register('mechanicId')}>
                  <option value="">Unassigned</option>
                  {(mechanics?.data ?? []).map((mechanic) => (
                    <option key={mechanic.id} value={mechanic.id}>
                      {mechanic.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}

          <FormField name="dueDate" label="Due date" error={errors.dueDate?.message}>
            {(field) => <Input {...field} {...register('dueDate')} type="date" />}
          </FormField>

          <FormField
            name="dueMileage"
            label="Due at odometer (km)"
            error={errors.dueMileage?.message}
          >
            {(field) => <Input {...field} {...register('dueMileage')} type="number" min={1} />}
          </FormField>
        </div>

        {kind === 'SCHEDULED' ? (
          <Alert tone="info">
            Scheduled work needs a due date or a due odometer reading, so it can appear in upcoming
            lists and become overdue if it is missed.
          </Alert>
        ) : null}

        <FormField name="vendor" label="Vendor" error={errors.vendor?.message}>
          {(field) => (
            <Input {...field} {...register('vendor')} placeholder="Atlas Auto Services" />
          )}
        </FormField>

        <FormField name="description" label="Notes" error={errors.description?.message}>
          {(field) => <Textarea {...field} {...register('description')} rows={3} />}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            Create job
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Complete a job — MNT-05, MNT-06
// ---------------------------------------------------------------------------

/**
 * Completion captures the odometer and the final costs.
 *
 * Both are facts of the moment. Asked for later they become estimates, and the
 * odometer in particular is what the trigger engine measures the next service
 * from — so a guess here shifts every future service for that vehicle.
 */
export function CompleteJobDialog({
  open,
  onOpenChange,
  operation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: MaintenanceOp;
}) {
  const changeStatus = useChangeOperationStatus();
  const [completedMileage, setCompletedMileage] = useState('');
  const [costParts, setCostParts] = useState(operation.costParts);
  const [costLabour, setCostLabour] = useState(operation.costLabour);
  const [error, setLocalError] = useState<string | null>(null);

  const total = (Number(costParts) || 0) + (Number(costLabour) || 0);

  async function submit(): Promise<void> {
    setLocalError(null);
    try {
      await changeStatus.mutateAsync({
        id: operation.id,
        body: {
          status: 'COMPLETED',
          ...(completedMileage ? { completedMileage: Number(completedMileage) } : {}),
          costParts: costParts || '0',
          costLabour: costLabour || '0',
        },
      });
      reportSuccess('Job completed');
      onOpenChange(false);
    } catch (mutationError) {
      reportMutationError(mutationError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Complete — ${operation.title}`}
      description={`${operation.plate} · ${operation.make} ${operation.model}`}
    >
      <div className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}

        <FormField
          name="completedMileage"
          label="Odometer at completion (km)"
          hint="Used to schedule the next service for this vehicle."
        >
          {(field) => (
            <Input
              {...field}
              type="number"
              min={0}
              value={completedMileage}
              onChange={(event) => setCompletedMileage(event.target.value)}
              autoFocus
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="costParts" label="Parts">
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                value={costParts}
                onChange={(event) => setCostParts(event.target.value)}
              />
            )}
          </FormField>

          <FormField name="costLabour" label="Labour">
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                value={costLabour}
                onChange={(event) => setCostLabour(event.target.value)}
              />
            )}
          </FormField>
        </div>

        <p className="text-sm text-muted-foreground">
          Total: <span className="font-medium text-foreground">{formatMoney(total)}</span>
        </p>

        <Alert tone="warning">
          Completed work cannot be edited or reopened — it becomes part of the cost history.
        </Alert>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={changeStatus.isPending}>
            {changeStatus.isPending ? <Spinner /> : null}
            Complete job
          </Button>
        </FormActions>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Assign a mechanic — MNT-07
// ---------------------------------------------------------------------------

export function AssignMechanicDialog({
  open,
  onOpenChange,
  operation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: MaintenanceOp;
}) {
  const { can } = useSession();
  const assign = useAssignMechanic();
  const { data: mechanics } = useMechanics(can('users', 'read'));
  const [mechanicId, setMechanicId] = useState(operation.mechanicId ?? '');

  async function submit(): Promise<void> {
    try {
      await assign.mutateAsync({
        id: operation.id,
        body: { mechanicId: mechanicId || null },
      });
      reportSuccess(mechanicId ? 'Mechanic assigned' : 'Job unassigned');
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign — ${operation.title}`}
      description={`${operation.plate} · currently ${operation.mechanicName ?? 'unassigned'}`}
    >
      <div className="space-y-5">
        <FormField
          name="mechanicId"
          label="Mechanic"
          hint="Only users with the Mechanic role can be assigned work."
        >
          {(field) => (
            <Select
              {...field}
              value={mechanicId}
              onChange={(event) => setMechanicId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {(mechanics?.data ?? []).map((mechanic) => (
                <option key={mechanic.id} value={mechanic.id}>
                  {mechanic.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {operation.dueMileage ? (
          <p className="text-xs text-muted-foreground">
            Due at {formatMileage(operation.dueMileage)}.
          </p>
        ) : null}

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={assign.isPending}>
            {assign.isPending ? <Spinner /> : null}
            Save
          </Button>
        </FormActions>
      </div>
    </FormDialog>
  );
}
