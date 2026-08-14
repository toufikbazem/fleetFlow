import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Form controls — FF-1105.
 *
 * One shape shared by every control in the product, so a form reads as a form
 * rather than as a collection of widgets: 36px tall, the same radius as a
 * button, a hairline border that firms up on hover, and a focus ring drawn from
 * the brand. Invalid state is styled from `aria-invalid`, which `FormField`
 * sets — the visual and the assistive signal come from the same attribute, so
 * they cannot disagree.
 */

const controlBase = [
  'w-full rounded-lg border border-input bg-card text-sm text-foreground shadow-xs',
  'transition-[border-color,box-shadow,background-color] duration-150',
  'placeholder:text-muted-foreground/70',
  'hover:border-border-strong',
  'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
  'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20',
].join(' ');

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(controlBase, 'h-9 px-3 py-1', className)}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlBase, 'min-h-20 resize-y px-3 py-2 leading-relaxed', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, style, ...props }, ref) => (
  // A native <select>: it is keyboard accessible, works on mobile without
  // custom code, and needs no portal. A Radix Select is worth its weight only
  // when the options need rich content, which none of these do.
  //
  // The platform's own arrow is a different shape, size and colour on every OS,
  // so `appearance-none` removes it and ours is painted as a background image
  // from the `--chevron` variable — see the note beside it in index.css.
  <select
    ref={ref}
    className={cn(
      controlBase,
      'h-9 cursor-pointer appearance-none py-1 pl-3 pr-9',
      // Options are painted by the OS, not by us; naming the colours keeps a
      // dark-theme dropdown from rendering black-on-black on Windows.
      '[&>option]:bg-card [&>option]:text-foreground',
      className,
    )}
    style={{
      backgroundImage: 'var(--chevron)',
      backgroundPosition: 'right 0.625rem center',
      backgroundSize: '1rem',
      backgroundRepeat: 'no-repeat',
      ...style,
    }}
    {...props}
  />
));
Select.displayName = 'Select';

/**
 * Checkbox.
 *
 * The native control, tinted with `accent-color` rather than rebuilt out of
 * divs — it keeps the platform's keyboard behaviour, its indeterminate state
 * and its screen-reader semantics for the price of one line of CSS.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded-xs border-input accent-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';

/**
 * A checkbox with its label, as one target.
 *
 * Wrapping is right here and wrong in `FormField`: this is a single control
 * whose label *is* its hit area, so a driver's thumb has 40px to land in.
 */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: InputProps & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5',
        'transition-colors hover:border-border-strong hover:bg-muted/50',
        'has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      <Checkbox className="mt-0.5" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
