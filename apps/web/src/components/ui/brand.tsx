/**
 * Brand mark — FF-1105.
 *
 * Drawn rather than imported: the client's logo has not been delivered, and an
 * SVG defined here costs no request, scales to any size, and inherits the theme
 * instead of shipping a colour of its own that would fight the dark palette.
 *
 * The form is two motion strokes — a long one and a short one closing on a
 * point. It reads as movement and as a checklist at the same time, which is
 * what the product is: things moving, and someone keeping track of them.
 */

import { cn } from '@/lib/utils';

export function BrandMark({
  className,
  tone = 'brand',
}: {
  className?: string;
  /** `inverse` for use on the brand panel, where a solid primary tile would
   *  disappear into the surface it is sitting on. */
  tone?: 'brand' | 'inverse';
}) {
  const inverse = tone === 'inverse';

  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0', className)}
      role="img"
      aria-label="FleetFlow"
    >
      <rect width="32" height="32" rx="9" className={inverse ? 'fill-white/12' : 'fill-primary'} />
      <path
        d="M8 12.5h16M8 20h9.5"
        className={inverse ? 'stroke-current' : 'stroke-primary-foreground'}
        strokeWidth="2.75"
        strokeLinecap="round"
      />
      {/* The terminal dot is the accent's only appearance in the chrome — the
          full stop at the end of the route. */}
      <circle cx="22.5" cy="20" r="2.5" className="fill-accent" />
    </svg>
  );
}

/** The mark with the name beside it. Used in the sidebar and on the auth pages. */
export function BrandLockup({
  className,
  markClassName,
  tagline,
}: {
  className?: string;
  markClassName?: string;
  tagline?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark className={markClassName} />
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">
          Fleet<span className="text-primary">Flow</span>
        </p>
        {tagline ? (
          <p className="mt-1 text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}
