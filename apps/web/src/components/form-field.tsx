/**
 * Form field — FF-1102 / FF-1105.
 *
 * Wires a label, control, hint and error message together with the ARIA
 * attributes that make them one thing to assistive technology. Done by hand at
 * every call site, `aria-describedby` is the first thing forgotten, and the
 * error text then exists visually but not for a screen reader.
 *
 * The layout is deliberate too. The hint sits under the control rather than
 * above it, so the eye reaches the input at the same vertical offset in every
 * field and the column of controls stays aligned; the error replaces the hint
 * rather than pushing it down, so nothing below the field moves when validation
 * fails and the user's next target does not jump out from under the cursor.
 */

import { AlertCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  name: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /** Receives the props the control must spread to be correctly associated. */
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
}

export function FormField({
  name,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label
        htmlFor={id}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"
      >
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </label>

      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}

      {hint && !error ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        // aria-live so a validation failure arriving after submit is announced,
        // not just repainted. The icon is what makes it distinguishable from the
        // hint without relying on colour alone.
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium leading-relaxed text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The row of buttons that closes a form.
 *
 * Identical markup had been written at the bottom of eight dialogs, and they
 * had already drifted apart in spacing. Here it is one thing, and it is the
 * place the mobile rule lives: below `sm` the buttons go full width and stack,
 * because two 90px buttons side by side on a 360px screen are a miss waiting
 * to happen.
 */
export function FormActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end',
        '[&>button]:w-full sm:[&>button]:w-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}
