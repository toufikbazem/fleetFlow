/**
 * Presentational primitives — FF-1102 / FF-1105.
 *
 * The vocabulary every screen is built from: surfaces, status, states, and the
 * page frame. Grouped in one file because each is a handful of lines; splitting
 * them into a dozen modules would add navigation cost without adding clarity.
 *
 * Nothing here names a colour literal. Everything resolves to a token, which is
 * what lets the whole product change theme without a single component knowing.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { Inbox, Loader2, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Card — the one surface everything sits on
// ---------------------------------------------------------------------------

export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Lifts on hover. Only for cards that are themselves a control. */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-5 pb-4 pt-5', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-base font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-border bg-surface px-5 py-3.5',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A card header with a title on the left and an action on the right.
 *
 * Every panel on the dashboard and the detail page wanted this shape, and each
 * had built it slightly differently — different gaps, different type sizes.
 * One component means one answer.
 */
export function SectionHeader({
  title,
  description,
  action,
  icon: Icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pb-4 pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge — the visual vocabulary for every status in the product
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  [
    'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border',
    'px-2 py-0.5 text-xs font-medium leading-5',
    // Preflight sets `svg { display: block }`, which turns a badge carrying a
    // leading icon into two lines. Inline-block puts it back on the baseline.
    '[&_svg]:inline-block [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/20 bg-success-soft text-success',
        warning: 'border-warning/25 bg-warning-soft text-warning',
        danger: 'border-destructive/20 bg-destructive-soft text-destructive',
        info: 'border-primary/20 bg-primary-soft text-primary',
        accent: 'border-accent/20 bg-accent-soft text-accent',
        outline: 'border-border bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & {
    /** A leading dot. Colour alone is not a signal; the dot gives it a shape. */
    dot?: boolean;
  }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A small count, for tabs and nav entries. Reads as a quantity, not a status. */
export function CountPill({
  value,
  className,
  active = false,
}: {
  value: number;
  className?: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular',
        active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

export function Alert({
  tone = 'danger',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: 'danger' | 'info' | 'warning' | 'success';
}) {
  const tones = {
    danger: 'border-destructive/25 bg-destructive-soft text-destructive',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    info: 'border-primary/20 bg-primary-soft text-primary',
    success: 'border-success/20 bg-success-soft text-success',
  } as const;

  return (
    <div
      // `role="alert"` so a screen reader announces a failed sign-in rather than
      // leaving the user wondering why nothing happened.
      role="alert"
      className={cn(
        'rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />;
}

/**
 * A block that stands in for content while it loads.
 *
 * Preferred over a spinner wherever the final shape is known: it holds the
 * layout still, so nothing jumps when the data lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

/** The whole-screen wait, used while a page's first request is in flight. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-20"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-6 text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

/**
 * The top of every screen: what this is, what it covers, and what you can do.
 *
 * `eyebrow` names the area the page belongs to. It costs one line and removes
 * the "where am I" question that a sidebar alone does not answer on a phone,
 * where the sidebar is not on screen at all.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Empty state.
 *
 * Three parts, always: an icon so the block reads as deliberate rather than as
 * a failed render, a sentence saying what is missing, and — where there is one —
 * the action that would fill it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Error state.
 *
 * Distinct from empty on purpose: "there is nothing here" and "we could not
 * find out" are different facts, and a user who cannot tell them apart will
 * either wait for data that is not coming or chase data that never existed.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-14 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-destructive/25 bg-destructive-soft text-destructive">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden>
          <path
            d="M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.4A2 2 0 0 0 4.1 20.4h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div>
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/**
 * A key/value pair, for detail panels and card footers.
 *
 * The label is small and quiet, the value is the thing being read. Everywhere
 * this pattern appeared it had been rebuilt by hand, and the label and value
 * sizes never quite matched between screens.
 */
export function DetailItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-2xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Monospaced identifier — a plate, a VIN, a reference number. */
export function Mono({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-mono text-[0.95em] tracking-tight', className)} {...props} />;
}
