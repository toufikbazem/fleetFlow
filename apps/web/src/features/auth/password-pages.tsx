/**
 * Password recovery — FF-1101, AUTH-02.
 *
 * Three screens sharing one flow: request a link, redeem it, and the
 * invitation variant of the same redemption (FF-302). The invitation reuses
 * this endpoint because it is the same single-use token mechanism; only the
 * wording differs, so the user is told what they are actually doing.
 *
 * All of them render inside `AuthLayout`, so the front door looks like one
 * place however you arrived at it.
 */

import {
  FORGOT_PASSWORD_ACK,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type ForgotPasswordRequest,
} from '@fleetflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, MailCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Spinner } from '@/components/ui/primitives';
import { ApiError, apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { AuthLayout } from './login-page';

/**
 * The end of a flow: a mark, a sentence, and the one thing to do next.
 *
 * Every terminal state on these screens had been a card with a title and a
 * button, and each was worded and spaced slightly differently. Sharing one
 * component means "we sent the email", "your password changed" and "this link
 * is broken" all land with the same weight, distinguished by tone rather than
 * by layout.
 */
function Outcome({
  tone,
  icon: Icon,
  title,
  description,
  action,
}: {
  tone: 'success' | 'info' | 'warning';
  icon: typeof MailCheck;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  const tones = {
    success: 'bg-success-soft text-success',
    info: 'bg-primary-soft text-primary',
    warning: 'bg-warning-soft text-warning',
  } as const;

  return (
    <div className="text-center">
      <span
        className={cn('mx-auto flex size-12 items-center justify-center rounded-xl', tones[tone])}
      >
        <Icon className="size-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-7">{action}</div>
    </div>
  );
}

/** The outcome screens replace the layout's own heading, so they pass none. */
function OutcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-5 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request a reset link
// ---------------------------------------------------------------------------

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordRequest): Promise<void> {
    setFormError(null);
    try {
      await apiRequest('/auth/forgot-password', { method: 'POST', body: values });
      setSent(true);
    } catch (error) {
      // A rate limit is the one failure worth reporting. Anything else is
      // swallowed into the same acknowledgement: the server deliberately does
      // not reveal whether the address exists, and a distinguishable error here
      // would leak exactly what it protects.
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setFormError(error.message);
        return;
      }
      setSent(true);
    }
  }

  if (sent) {
    return (
      <OutcomeLayout>
        <Outcome
          tone="info"
          icon={MailCheck}
          title="Check your email"
          description={FORGOT_PASSWORD_ACK}
          action={
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Back to sign in</Link>
            </Button>
          }
        />
      </OutcomeLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your email address and we will send you a link to choose a new password."
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

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          Send reset link
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Redeem a token — shared by password reset and invitation acceptance
// ---------------------------------------------------------------------------

/**
 * Confirmation is client-only: the API takes one password, and a mistyped new
 * password that nobody can reproduce is the most common way a reset flow locks
 * somebody out.
 */
const setPasswordFormSchema = z
  .object({
    password: resetPasswordRequestSchema.shape.password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

type SetPasswordForm = z.infer<typeof setPasswordFormSchema>;

function SetPasswordPage({
  title,
  description,
  submitLabel,
  successMessage,
}: {
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordForm>({
    resolver: zodResolver(setPasswordFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: SetPasswordForm): Promise<void> {
    setFormError(null);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token, password: values.password },
      });
      setDone(true);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  }

  if (!token) {
    return (
      <OutcomeLayout>
        <Outcome
          tone="warning"
          icon={TriangleAlert}
          title="This link is incomplete"
          description="The address is missing its token. Open the link from your email again, or request a new one."
          action={
            <Button asChild variant="outline" className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          }
        />
      </OutcomeLayout>
    );
  }

  if (done) {
    return (
      <OutcomeLayout>
        <Outcome
          tone="success"
          icon={CheckCircle2}
          title={successMessage}
          description="You have been signed out everywhere else. Sign in with your new password."
          action={
            <Button
              size="lg"
              className="w-full"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </Button>
          }
        />
      </OutcomeLayout>
    );
  }

  return (
    <AuthLayout title={title} description={description}>
      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="space-y-4"
        noValidate
      >
        {formError ? <Alert>{formError}</Alert> : null}

        <FormField
          name="password"
          label="New password"
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
              autoFocus
            />
          )}
        </FormField>

        <FormField
          name="confirmPassword"
          label="Confirm password"
          error={errors.confirmPassword?.message}
          required
        >
          {(field) => (
            <Input
              {...field}
              {...register('confirmPassword')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  return (
    <SetPasswordPage
      title="Choose a new password"
      description="Pick a password you have not used before."
      submitLabel="Set new password"
      successMessage="Your password has been changed"
    />
  );
}

/** FF-302 — the same redemption, worded for someone who has never signed in. */
export function AcceptInvitationPage() {
  return (
    <SetPasswordPage
      title="Set up your account"
      description="Choose a password to finish setting up your FleetFlow account."
      submitLabel="Create my password"
      successMessage="Your account is ready"
    />
  );
}
