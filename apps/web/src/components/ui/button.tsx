import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button — FF-1105.
 *
 * Seven variants, and each one means something. `default` is the single action
 * a screen is asking for; `outline` is everything else on the same row;
 * `ghost` is an icon in a table cell; `destructive` is the one that cannot be
 * undone. A screen with three solid primaries has told the user nothing about
 * what to do next, so the variants are the hierarchy, not decoration.
 */
const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'font-medium tracking-[-0.005em]',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    // Icons never dictate the button's height, and they never stretch.
    '[&_svg]:size-4 [&_svg]:shrink-0',
    // A press is acknowledged. One frame of travel, no bounce.
    'active:translate-y-px',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover hover:shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 hover:shadow-sm',
        outline:
          'border border-border bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-muted/60',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        // A ghost that is unmistakably dangerous once hovered.
        'ghost-destructive':
          'text-muted-foreground hover:bg-destructive-soft hover:text-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 36px minimum: below that a touch target is unreliable, and drivers
        // use this on a phone at the roadside.
        default: 'h-9 rounded-lg px-3.5 text-sm',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-6 text-base',
        icon: 'size-9 rounded-lg',
        'icon-sm': 'size-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renders the child element instead of a <button> — for links styled as buttons. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // Buttons inside a form default to "submit" in HTML, which silently
        // submits when someone adds a Cancel button and forgets to say so.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

/**
 * A toggle rendered as a segmented control.
 *
 * Used where a filter has two or three states and the options are worth showing
 * at once — a select would hide two thirds of the answer behind a click.
 */
export function SegmentedControl({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5', className)}
      {...props}
    />
  );
}

export function SegmentedItem({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        active
          ? 'bg-card text-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { buttonVariants };
