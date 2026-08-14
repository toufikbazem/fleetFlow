/**
 * Create / edit driver — FF-304, DRV-01, DRV-04.
 */

import {
  DRIVER_STATUSES,
  createDriverRequestSchema,
  type CreateDriverRequest,
  type Driver,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { FormDialog } from '@/components/confirm-dialog';
import { FormActions, FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/primitives';
import { humanise } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useCreateDriver, useLinkableAccounts, useUpdateDriver } from './api';

export function DriverFormDialog({
  open,
  onOpenChange,
  driver,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driver?: Driver | undefined;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={driver ? 'Edit driver' : 'Add driver'}
      description="A driver does not need a login account. Link one only if they will use FleetFlow themselves."
    >
      <DriverForm driver={driver} onDone={() => onOpenChange(false)} />
    </FormDialog>
  );
}

function DriverForm({ driver, onDone }: { driver?: Driver | undefined; onDone: () => void }) {
  const { can } = useSession();
  const createDriver = useCreateDriver();
  const updateDriver = useUpdateDriver();

  // Only administrators may list users (PRD §2.1), so only they can pick an
  // account to link. See the note in api.ts.
  const canLinkAccounts = can('users', 'read');
  const { data: accounts } = useLinkableAccounts(canLinkAccounts);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateDriverRequest>({
    resolver: zodResolver(createDriverRequestSchema),
    defaultValues: {
      firstName: driver?.firstName ?? '',
      lastName: driver?.lastName ?? '',
      licenceNo: driver?.licenceNo ?? '',
      licenceCategory: driver?.licenceCategory ?? '',
      licenceExpiry: driver?.licenceExpiry ?? '',
      phone: driver?.phone ?? '',
      hiredAt: driver?.hiredAt ?? '',
      status: driver?.status ?? 'ACTIVE',
      userId: driver?.userId ?? null,
    },
  });

  async function onSubmit(values: CreateDriverRequest): Promise<void> {
    // Empty optional strings are dropped rather than sent: the API distinguishes
    // "not provided" from "cleared", and `''` would fail a date or length rule.
    const body: CreateDriverRequest = {
      firstName: values.firstName,
      lastName: values.lastName,
      licenceNo: values.licenceNo,
      status: values.status,
      ...(values.licenceCategory ? { licenceCategory: values.licenceCategory } : {}),
      ...(values.licenceExpiry ? { licenceExpiry: values.licenceExpiry } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.hiredAt ? { hiredAt: values.hiredAt } : {}),
      ...(canLinkAccounts ? { userId: values.userId || null } : {}),
    };

    try {
      if (driver) {
        await updateDriver.mutateAsync({ id: driver.id, body });
        reportSuccess('Driver updated');
      } else {
        await createDriver.mutateAsync(body);
        reportSuccess(`${body.firstName} ${body.lastName} was added`);
      }
      onDone();
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="firstName" label="First name" error={errors.firstName?.message} required>
          {(field) => <Input {...field} {...register('firstName')} autoFocus />}
        </FormField>

        <FormField name="lastName" label="Last name" error={errors.lastName?.message} required>
          {(field) => <Input {...field} {...register('lastName')} />}
        </FormField>

        <FormField
          name="licenceNo"
          label="Licence number"
          error={errors.licenceNo?.message}
          required
        >
          {(field) => <Input {...field} {...register('licenceNo')} />}
        </FormField>

        <FormField
          name="licenceCategory"
          label="Licence category"
          error={errors.licenceCategory?.message}
        >
          {(field) => <Input {...field} {...register('licenceCategory')} placeholder="B, C, D…" />}
        </FormField>

        <FormField
          name="licenceExpiry"
          label="Licence expiry"
          hint="Used by the expiring-licences view."
          error={errors.licenceExpiry?.message}
        >
          {(field) => <Input {...field} {...register('licenceExpiry')} type="date" />}
        </FormField>

        <FormField name="phone" label="Phone" error={errors.phone?.message}>
          {(field) => <Input {...field} {...register('phone')} type="tel" />}
        </FormField>

        <FormField name="hiredAt" label="Hired on" error={errors.hiredAt?.message}>
          {(field) => <Input {...field} {...register('hiredAt')} type="date" />}
        </FormField>

        <FormField name="status" label="Status" error={errors.status?.message}>
          {(field) => (
            <Select {...field} {...register('status')}>
              {DRIVER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humanise(status)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      {canLinkAccounts ? (
        <FormField
          name="userId"
          label="Login account"
          hint="Optional. Only accounts with the Driver role can be linked."
          error={errors.userId?.message}
        >
          {(field) => (
            <Select {...field} {...register('userId')}>
              <option value="">No login account</option>
              {(accounts?.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.email}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}

      <FormActions>
        <Button variant="outline" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {driver ? 'Save changes' : 'Add driver'}
        </Button>
      </FormActions>
    </form>
  );
}
