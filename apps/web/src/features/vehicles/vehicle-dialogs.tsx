/**
 * Vehicle dialogs — FF-406.
 *
 * Create/edit, record mileage, assign a driver. Each is small, and they share
 * the same shell, so they live together rather than in three files.
 */

import {
  createVehicleRequestSchema,
  recordMileageRequestSchema,
  type CreateVehicleRequest,
  type Driver,
  type RecordMileageRequest,
  type Vehicle,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { FormDialog } from '@/components/confirm-dialog';
import { FormActions, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { CheckboxField, Input, Select, Textarea } from '@/components/ui/input';
import { Alert, Spinner } from '@/components/ui/primitives';
import { formatMileage } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import {
  useAssignDriver,
  useCreateVehicle,
  useRecordMileage,
  useUpdateVehicle,
  useVehicleTypes,
} from './api';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

export function VehicleFormDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: Vehicle | undefined;
}) {
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const { data: types } = useVehicleTypes();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateVehicleRequest>({
    resolver: zodResolver(createVehicleRequestSchema),
    defaultValues: {
      plate: vehicle?.plate ?? '',
      vin: vehicle?.vin ?? '',
      make: vehicle?.make ?? '',
      model: vehicle?.model ?? '',
      year: vehicle?.year ?? undefined,
      vehicleTypeId: vehicle?.vehicleTypeId ?? undefined,
      currentMileage: vehicle?.currentMileage ?? 0,
      purchaseDate: vehicle?.purchaseDate ?? '',
      purchasePrice: vehicle?.purchasePrice ?? '',
      insuranceValue: vehicle?.insuranceValue ?? '',
      notes: vehicle?.notes ?? '',
    },
  });

  async function onSubmit(values: CreateVehicleRequest): Promise<void> {
    // Optional empties are omitted rather than sent: the API distinguishes
    // "not provided" from "cleared", and '' fails the VIN and money patterns.
    const shared = {
      plate: values.plate,
      make: values.make,
      model: values.model,
      ...(values.vin ? { vin: values.vin } : {}),
      ...(values.year ? { year: values.year } : {}),
      ...(values.vehicleTypeId ? { vehicleTypeId: values.vehicleTypeId } : {}),
      ...(values.purchaseDate ? { purchaseDate: values.purchaseDate } : {}),
      ...(values.purchasePrice ? { purchasePrice: values.purchasePrice } : {}),
      ...(values.insuranceValue ? { insuranceValue: values.insuranceValue } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };

    try {
      if (vehicle) {
        await updateVehicle.mutateAsync({ id: vehicle.id, body: shared });
        reportSuccess('Vehicle updated');
      } else {
        await createVehicle.mutateAsync({ ...shared, currentMileage: values.currentMileage });
        reportSuccess(`${values.plate} was added`);
      }
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={vehicle ? `Edit ${vehicle.plate}` : 'Add vehicle'}
      description={vehicle ? undefined : 'The plate is how everyone will find this vehicle.'}
      size="lg"
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="plate" label="Plate" error={errors.plate?.message} required>
            {(field) => (
              <Input {...field} {...register('plate')} autoFocus placeholder="12345-A-6" />
            )}
          </FormField>

          <FormField
            name="vin"
            label="VIN"
            hint="17 characters, if you have it."
            error={errors.vin?.message}
          >
            {(field) => <Input {...field} {...register('vin')} />}
          </FormField>

          <FormField name="make" label="Make" error={errors.make?.message} required>
            {(field) => <Input {...field} {...register('make')} placeholder="Renault" />}
          </FormField>

          <FormField name="model" label="Model" error={errors.model?.message} required>
            {(field) => <Input {...field} {...register('model')} placeholder="Master" />}
          </FormField>

          <FormField name="year" label="Year" error={errors.year?.message}>
            {(field) => <Input {...field} {...register('year')} type="number" />}
          </FormField>

          <FormField name="vehicleTypeId" label="Type" error={errors.vehicleTypeId?.message}>
            {(field) => (
              <Select {...field} {...register('vehicleTypeId')}>
                <option value="">Not set</option>
                {(types?.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {!vehicle ? (
            <FormField
              name="currentMileage"
              label="Current odometer (km)"
              hint="Recorded as the opening reading."
              error={errors.currentMileage?.message}
            >
              {(field) => (
                <Input {...field} {...register('currentMileage')} type="number" min={0} />
              )}
            </FormField>
          ) : null}

          <FormField name="purchaseDate" label="Purchased on" error={errors.purchaseDate?.message}>
            {(field) => <Input {...field} {...register('purchaseDate')} type="date" />}
          </FormField>

          <FormField
            name="purchasePrice"
            label="Purchase price"
            error={errors.purchasePrice?.message}
          >
            {(field) => (
              <Input
                {...field}
                {...register('purchasePrice')}
                inputMode="decimal"
                placeholder="28500.00"
              />
            )}
          </FormField>

          <FormField
            name="insuranceValue"
            label="Insured value"
            error={errors.insuranceValue?.message}
          >
            {(field) => <Input {...field} {...register('insuranceValue')} inputMode="decimal" />}
          </FormField>
        </div>

        <FormField name="notes" label="Notes" error={errors.notes?.message}>
          {(field) => <Textarea {...field} {...register('notes')} rows={3} />}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            {vehicle ? 'Save changes' : 'Add vehicle'}
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Record mileage — VEH-05
// ---------------------------------------------------------------------------

export function MileageDialog({
  open,
  onOpenChange,
  vehicle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: Vehicle;
}) {
  const recordMileage = useRecordMileage();
  const [isCorrection, setIsCorrection] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RecordMileageRequest>({
    resolver: zodResolver(recordMileageRequestSchema),
    defaultValues: { mileage: vehicle.currentMileage, note: '', isCorrection: false },
  });

  const entered = Number(watch('mileage'));
  const isLower = Number.isFinite(entered) && entered < vehicle.currentMileage;

  async function onSubmit(values: RecordMileageRequest): Promise<void> {
    try {
      await recordMileage.mutateAsync({
        id: vehicle.id,
        body: {
          mileage: values.mileage,
          isCorrection,
          ...(values.note ? { note: values.note } : {}),
        },
      });
      reportSuccess('Reading recorded');
      onOpenChange(false);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Record odometer — ${vehicle.plate}`}
      description={`Last recorded: ${formatMileage(vehicle.currentMileage)}`}
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        <FormField
          name="mileage"
          label="Odometer reading (km)"
          error={errors.mileage?.message}
          required
        >
          {(field) => <Input {...field} {...register('mileage')} type="number" min={0} autoFocus />}
        </FormField>

        {isLower && !isCorrection ? (
          // Warned before submitting rather than after: the server will refuse
          // this, and explaining why here saves a round trip and a rejection.
          <Alert tone="warning">
            That is lower than the last reading. An odometer only goes up, so tick
            &ldquo;correction&rdquo; below if the instrument was replaced or the previous entry was
            wrong.
          </Alert>
        ) : null}

        <CheckboxField
          label="This is a correction"
          description="Use this when the instrument was replaced or an earlier entry was wrong."
          checked={isCorrection}
          onChange={(event) => setIsCorrection(event.target.checked)}
        />

        <FormField
          name="note"
          label="Note"
          hint={isCorrection ? 'Required for a correction.' : 'Optional.'}
          error={errors.note?.message}
          required={isCorrection}
        >
          {(field) => <Textarea {...field} {...register('note')} rows={2} />}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner /> : null}
            Record reading
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Assign a driver — DRV-02 / Q5
// ---------------------------------------------------------------------------

export function AssignDriverDialog({
  open,
  onOpenChange,
  vehicle,
  drivers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: Vehicle;
  drivers: Driver[];
}) {
  const assignDriver = useAssignDriver();
  const [driverId, setDriverId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [error, setLocalError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!driverId) {
      setLocalError('Choose a driver.');
      return;
    }
    setLocalError(null);

    try {
      await assignDriver.mutateAsync({
        vehicleId: vehicle.id,
        driverId,
        closeExisting: true,
        ...(startDate ? { startDate } : {}),
      });
      reportSuccess(vehicle.currentDriver ? 'Vehicle handed over' : 'Driver assigned');
      onOpenChange(false);
    } catch (mutationError) {
      reportMutationError(mutationError);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={vehicle.currentDriver ? `Hand over ${vehicle.plate}` : `Assign ${vehicle.plate}`}
      description={
        vehicle.currentDriver
          ? // Q5 made visible: the user is told what will happen to the existing
            // assignment rather than discovering it afterwards.
            `${vehicle.currentDriver.firstName} ${vehicle.currentDriver.lastName} currently holds this vehicle. Assigning someone else ends their assignment and keeps it in the history.`
          : 'One driver holds a vehicle at a time.'
      }
    >
      <div className="space-y-5">
        {error ? <Alert>{error}</Alert> : null}

        <FormField name="driverId" label="Driver" required>
          {(field) => (
            <Select
              {...field}
              value={driverId}
              onChange={(event) => setDriverId(event.target.value)}
            >
              <option value="">Choose a driver…</option>
              {drivers
                .filter((driver) => driver.status === 'ACTIVE')
                .map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.firstName} {driver.lastName}
                    {driver.currentAssignments.length > 0
                      ? ` · already holds ${driver.currentAssignments.map((a) => a.plate).join(', ')}`
                      : ''}
                  </option>
                ))}
            </Select>
          )}
        </FormField>

        <FormField name="startDate" label="Handover date" hint="Defaults to today.">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          )}
        </FormField>

        <FormActions>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={assignDriver.isPending}>
            {assignDriver.isPending ? <Spinner /> : null}
            {vehicle.currentDriver ? 'Hand over' : 'Assign'}
          </Button>
        </FormActions>
      </div>
    </FormDialog>
  );
}
