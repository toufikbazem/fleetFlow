/**
 * Create / edit user — FF-304, USR-01, USR-02, USR-04.
 */

import {
  USER_ROLES,
  createUserRequestSchema,
  updateUserRequestSchema,
  type CreateUserRequest,
  type UpdateUserRequest,
  type User,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type FieldValues, type Path, type UseFormRegister } from 'react-hook-form';
import { FormActions, FormField } from '@/components/form-field';
import { FormDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { CheckboxField, Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/primitives';
import { humanise } from '@/lib/format';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useCreateUser, useUpdateUser } from './api';

export function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent when creating. */
  user?: User | undefined;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? 'Edit user' : 'Add user'}
      description={
        user
          ? 'Changing a role signs the user out, so their next request carries the new one.'
          : 'Leave the password blank to email an invitation instead.'
      }
    >
      {user ? (
        <EditUserForm user={user} onDone={() => onOpenChange(false)} />
      ) : (
        <CreateUserForm onDone={() => onOpenChange(false)} />
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const createUser = useCreateUser();
  // Invitation is the default: setting a colleague's password means it travels
  // through whatever channel is used to tell them.
  const [setPasswordNow, setSetPasswordNow] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserRequest>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: { name: '', email: '', role: 'FLEET_MANAGER' },
  });

  async function onSubmit(values: CreateUserRequest): Promise<void> {
    try {
      const body: CreateUserRequest = setPasswordNow
        ? values
        : // Omitted rather than sent empty: the schema treats absence as
          // "invite them", and an empty string would fail the length rule.
          { name: values.name, email: values.email, role: values.role };

      const result = await createUser.mutateAsync(body);

      reportSuccess(
        result.invitationSent
          ? `Invitation sent to ${result.user.email}`
          : setPasswordNow
            ? `${result.user.name} can now sign in`
            : `${result.user.name} was created, but the invitation email could not be sent`,
      );
      onDone();
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-5" noValidate>
      <FormField name="name" label="Name" error={errors.name?.message} required>
        {(field) => <Input {...field} {...register('name')} autoFocus />}
      </FormField>

      <FormField name="email" label="Email" error={errors.email?.message} required>
        {(field) => <Input {...field} {...register('email')} type="email" />}
      </FormField>

      <RoleField register={register} error={errors.role?.message} />

      <CheckboxField
        label="Set a password now"
        description="Otherwise they are sent an invitation link and choose their own."
        checked={setPasswordNow}
        onChange={(event) => setSetPasswordNow(event.target.checked)}
      />

      {setPasswordNow ? (
        <FormField
          name="password"
          label="Password"
          hint="At least 12 characters."
          error={errors.password?.message}
          required
        >
          {(field) => (
            <Input
              {...field}
              {...register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>
      ) : null}

      <SubmitRow submitting={isSubmitting} onCancel={onDone} submitLabel="Create user" />
    </form>
  );
}

// ---------------------------------------------------------------------------

function EditUserForm({ user, onDone }: { user: User; onDone: () => void }) {
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UpdateUserRequest>({
    resolver: zodResolver(updateUserRequestSchema),
    defaultValues: { name: user.name, email: user.email, role: user.role },
  });

  async function onSubmit(values: UpdateUserRequest): Promise<void> {
    try {
      await updateUser.mutateAsync({ id: user.id, body: values });
      reportSuccess('User updated');
      onDone();
    } catch (error) {
      reportMutationError(error, setError);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="space-y-5" noValidate>
      <FormField name="name" label="Name" error={errors.name?.message} required>
        {(field) => <Input {...field} {...register('name')} autoFocus />}
      </FormField>

      <FormField name="email" label="Email" error={errors.email?.message} required>
        {(field) => <Input {...field} {...register('email')} type="email" />}
      </FormField>

      <RoleField register={register} error={errors.role?.message} />

      <SubmitRow submitting={isSubmitting} onCancel={onDone} submitLabel="Save changes" />
    </form>
  );
}

// ---------------------------------------------------------------------------

/**
 * Shared by both forms. Generic over the form shape so neither has to widen its
 * types — `any` here would silently disconnect the field name from the schema.
 */
function RoleField<T extends FieldValues>({
  register,
  error,
}: {
  register: UseFormRegister<T>;
  error?: string | undefined;
}) {
  return (
    <FormField
      name="role"
      label="Role"
      hint="Roles decide what this person can see and do."
      error={error}
      required
    >
      {(field) => (
        <Select {...field} {...register('role' as Path<T>)}>
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {humanise(role)}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

function SubmitRow({
  submitting,
  onCancel,
  submitLabel,
}: {
  submitting: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <FormActions>
      <Button variant="outline" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </FormActions>
  );
}
