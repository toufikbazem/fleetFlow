/**
 * Report a problem — FF-704, DMG-03.
 *
 * The most mobile-critical flow in the product. A driver fills this in at the
 * roadside, on a phone, possibly in the rain, and the PRD excludes a native
 * app — so the web form has to be usable one-handed.
 *
 * Concretely that means: no vehicle picker when they hold exactly one, large
 * touch targets, the camera reachable in one tap, and nothing required that a
 * person standing next to a dented van would not already know.
 */

import {
  DAMAGE_SEVERITIES,
  createDamageRequestSchema,
  type CreateDamageRequest,
  type Vehicle,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormDialog } from '@/components/confirm-dialog';
import { FileUploadField } from '@/components/file-upload-field';
import { FormActions, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Alert, Spinner } from '@/components/ui/primitives';
import { humanise } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useCreateDamage } from './api';

export function ReportDamageDialog({
  open,
  onOpenChange,
  vehicles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicles: Vehicle[];
}) {
  const createDamage = useCreateDamage();
  // The report exists before photos can be attached — an attachment needs
  // something to attach to. So the dialog has two phases rather than trying to
  // hold files in memory and upload them after the fact.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // A driver holds one vehicle, so there is nothing to choose. Asking anyway
  // would be a required field with one option.
  const onlyVehicle = vehicles.length === 1 ? vehicles[0] : undefined;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDamageRequest>({
    resolver: zodResolver(createDamageRequestSchema),
    defaultValues: {
      vehicleId: onlyVehicle?.id ?? '',
      description: '',
      severity: 'MEDIUM',
    },
  });

  /**
   * Fill the hidden vehicle once the driver's vehicle is known.
   *
   * `useForm` captures `defaultValues` on its first render, and `vehicles`
   * arrives from a query a moment later — so the form held `vehicleId: ''`
   * however the markup below looked. Setting `value` on the hidden input
   * changed the DOM but not the form state react-hook-form actually submits.
   *
   * The symptom was the worst kind: a driver pressed "Report a problem", the
   * request failed validation on a field they could not see, and the dialog
   * simply sat there. DMG-03 is the most mobile-critical flow in the product,
   * and it did not work at all.
   */
  useEffect(() => {
    if (onlyVehicle) setValue('vehicleId', onlyVehicle.id, { shouldValidate: false });
  }, [onlyVehicle, setValue]);

  function close(): void {
    setCreatedId(null);
    reset();
    onOpenChange(false);
  }

  async function onSubmit(values: CreateDamageRequest): Promise<void> {
    try {
      const result = await createDamage.mutateAsync({
        vehicleId: values.vehicleId,
        description: values.description,
        severity: values.severity,
        // Sent with the browser's offset so "this morning" resolves correctly
        // whatever timezone the server runs in.
        occurredAt: values.occurredAt ?? new Date().toISOString(),
        ...(values.location ? { location: values.location } : {}),
      });
      reportSuccess('Reported. Your fleet manager has been notified.');
      setCreatedId(result.damage.id);
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  if (createdId) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(value) => !value && close()}
        title="Report sent"
        description="Add photos if you can — they save the workshop a trip."
      >
        <div className="space-y-5">
          <FileUploadField entityType="DAMAGE" entityId={createdId} kind="PHOTO" label="Photos" />
          <FormActions>
            <Button onClick={close}>Done</Button>
          </FormActions>
        </div>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(value) => !value && close()}
      title="Report a problem"
      description={
        onlyVehicle
          ? `${onlyVehicle.plate} · ${onlyVehicle.make} ${onlyVehicle.model}`
          : 'Tell the fleet manager what happened.'
      }
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-5"
        noValidate
      >
        {vehicles.length === 0 ? (
          <Alert>
            You do not currently hold a vehicle, so there is nothing to report against. Ask your
            fleet manager if this looks wrong.
          </Alert>
        ) : null}

        {onlyVehicle ? (
          <input type="hidden" {...register('vehicleId')} value={onlyVehicle.id} />
        ) : (
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
        )}

        <FormField
          name="description"
          label="What happened?"
          hint="A sentence or two is enough."
          error={errors.description?.message}
          required
        >
          {(field) => (
            <Textarea
              {...field}
              {...register('description')}
              rows={4}
              autoFocus
              placeholder="Rear left door dented in a car park. It still closes and locks."
            />
          )}
        </FormField>

        <FormField name="severity" label="How bad is it?" error={errors.severity?.message}>
          {(field) => (
            <Select {...field} {...register('severity')} className="h-11">
              {DAMAGE_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                  {value === 'CRITICAL' ? ' — the vehicle is not safe to drive' : ''}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField name="location" label="Where?" error={errors.location?.message}>
          {(field) => (
            <Input
              {...field}
              {...register('location')}
              className="h-11"
              placeholder="Casablanca depot"
            />
          )}
        </FormField>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Camera className="size-4 shrink-0" aria-hidden />
          You can add photos on the next step.
        </p>

        {/* The controls above stay at 44px on a phone — this is the one form
            filled in standing at the roadside — so the buttons match them. */}
        <FormActions className="[&>button]:h-11 sm:[&>button]:h-9">
          <Button variant="outline" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || vehicles.length === 0}>
            {isSubmitting ? <Spinner /> : null}
            Send report
          </Button>
        </FormActions>
      </form>
    </FormDialog>
  );
}
