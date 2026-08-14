/**
 * Sign in — FF-1101, AUTH-01.
 *
 * The form validates with the same `loginRequestSchema` the API validates with,
 * so the client cannot drift into accepting something the server rejects.
 *
 * This is also the product's front door — there is no marketing site in front
 * of it — so it does the job a landing page would: it says what FleetFlow is
 * and what it keeps track of, in three lines drawn from what the product
 * actually does, and then gets out of the way. On a phone the panel collapses
 * to the mark and one line, because a driver signing in at 6am wants the form.
 */

import { loginRequestSchema, type LoginRequest } from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarClock, FileCheck2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { FormField } from '@/components/form-field';
import { BrandLockup, BrandMark } from '@/components/ui/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Spinner } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/session';

export function LoginPage() {
  const { user, loading, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  if (loading) return null;
  if (user) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(values: LoginRequest): Promise<void> {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      const from =
        (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (error) {
      // The server returns one message for every credential failure by design
      // (AUTH acceptance), so it is shown verbatim rather than reinterpreted —
      // guessing "wrong password" here would undo that.
      setFormError(
        error instanceof ApiError ? error.message : 'Could not reach FleetFlow. Try again.',
      );
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Use the account your fleet administrator set up for you."
    >
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-4"
        noValidate
      >
        {formError ? <Alert>{formError}</Alert> : null}

        <FormField name="email" label="Email" error={errors.email?.message} required>
          {(field) => (
            <Input
              {...field}
              {...register('email')}
              type="email"
              autoComplete="username"
              autoFocus
              placeholder="you@company.com"
            />
          )}
        </FormField>

        <FormField name="password" label="Password" error={errors.password?.message} required>
          {(field) => (
            <Input
              {...field}
              {...register('password')}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          Sign in
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgotten your password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

/** What the product keeps track of. Three facts, not three claims. */
const HIGHLIGHTS = [
  {
    icon: Wrench,
    title: 'Maintenance that schedules itself',
    body: 'Plans turn a rule — every 15 000 km, every six months — into jobs before anything is overdue.',
  },
  {
    icon: FileCheck2,
    title: 'Nothing lapses unnoticed',
    body: 'Insurance, inspections and registrations are watched against their own notice periods.',
  },
  {
    icon: CalendarClock,
    title: 'One record per vehicle',
    body: 'Drivers, odometer readings, costs and damage reports, all on the same page.',
  },
];

export function AuthLayout({
  children,
  title,
  description,
}: {
  children: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
      {/* ---------------------------------------------------------------
          The brand panel. Hidden below `lg`, where the form is the whole job.
          --------------------------------------------------------------- */}
      <aside className="relative hidden overflow-hidden bg-brand-panel text-brand-panel-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="brand-grid pointer-events-none absolute inset-0" aria-hidden />
        {/* A single soft light from the top-left, so the flat brand block has
            somewhere to come from. The only gradient in the product. */}
        <div
          className="pointer-events-none absolute -left-32 -top-32 size-128 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, color-mix(in oklab, var(--color-accent) 55%, transparent), transparent 70%)',
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <BrandMark tone="inverse" className="size-10" />
          <div>
            <p className="text-xl font-semibold tracking-tight">FleetFlow</p>
            <p className="text-2xs font-medium uppercase tracking-[0.16em] text-brand-panel-foreground/70">
              Fleet operations
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Every vehicle, every job, every expiry date — in one place.
          </h2>

          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/8 ring-1 ring-inset ring-white/15">
                  <item.icon className="size-4.5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-brand-panel-foreground/70">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-panel-foreground/60">
          FleetFlow — fleet management for teams that keep things moving.
        </p>
      </aside>

      {/* ---------------------------------------------------------------
          The form
          --------------------------------------------------------------- */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandLockup
            className="mb-8 lg:hidden"
            markClassName="size-9"
            tagline="Fleet operations"
          />

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}

          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
