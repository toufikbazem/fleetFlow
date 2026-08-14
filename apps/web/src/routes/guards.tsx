/**
 * Route guards — FF-1101.
 *
 * Two layers, matching the API's own split:
 *
 *   RequireSession   "I don't know who you are" → the login screen (401)
 *   RequireModule    "I know, and no"            → a refusal screen (403)
 *
 * Both read the shared MATRIX. Neither is a security control — the API decides
 * independently on every request, and a user who types a URL directly gets a
 * 403 from the server whatever this file does. These exist so the refusal is a
 * sentence rather than a blank screen full of failed requests.
 */

import { isAllowed, type Action, type Module } from '@fleetflow/shared';
import { Compass, Lock } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BrandMark } from '@/components/ui/brand';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/primitives';
import { useSession } from '@/lib/session';

export function RequireSession() {
  const { user, loading } = useSession();
  const location = useLocation();

  // The boot-time refresh has not settled yet. Redirecting now would bounce a
  // signed-in user to the login screen on every page reload.
  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <BrandMark className="size-10" />
        <Spinner className="size-5 text-muted-foreground" />
        <span className="sr-only">Restoring your session</span>
      </div>
    );
  }

  if (!user) {
    // `state.from` so the user lands where they were going after signing in,
    // rather than being dumped on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function RequireModule({ module, action = 'read' }: { module: Module; action?: Action }) {
  const { user } = useSession();

  if (user && !isAllowed(user.role, module, action)) {
    return <Forbidden />;
  }

  return <Outlet />;
}

/**
 * A refusal, or a wrong address.
 *
 * One component for both, because they are the same shape of moment: something
 * you expected to be here is not, and the only useful thing on the screen is
 * the way back. The mark distinguishes them at a glance, and the heading — not
 * the icon — is what carries the meaning.
 */
function DeadEnd({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      {icon}
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button asChild className="mt-7">
        <Link to="/">Back to the dashboard</Link>
      </Button>
    </div>
  );
}

export function Forbidden() {
  return (
    <DeadEnd
      icon={
        <span className="flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          <Lock className="size-6" aria-hidden />
        </span>
      }
      title="You do not have access to this page"
      body="Your role does not include this area of FleetFlow. If you think that is wrong, ask an administrator to review your permissions."
    />
  );
}

export function NotFound() {
  return (
    <DeadEnd
      icon={
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Compass className="size-6" aria-hidden />
        </span>
      }
      title="Page not found"
      body="The address you followed does not exist in FleetFlow."
    />
  );
}
