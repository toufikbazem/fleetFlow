/**
 * Router and providers — FF-1101.
 *
 * Route structure mirrors the permission model: everything under
 * `RequireSession` needs a signed-in user, and module areas add `RequireModule`
 * so a role without access gets an explanation rather than a screen of failed
 * requests.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/app-shell';
import {
  AcceptInvitationPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from '@/features/auth/password-pages';
import { LoginPage } from '@/features/auth/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { DamagesPage } from '@/features/damages/damages-page';
import { DocumentsPage } from '@/features/documents/documents-page';
import { DriversPage } from '@/features/drivers/drivers-page';
import { MaintenancePage } from '@/features/maintenance/maintenance-page';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { MaintenancePlansPage } from '@/features/maintenance/plans-page';
import { UsersPage } from '@/features/users/users-page';
import { VehicleDetailPage } from '@/features/vehicles/vehicle-detail-page';
import { VehiclesPage } from '@/features/vehicles/vehicles-page';
import { ApiError } from '@/lib/api-client';
import { SessionProvider } from '@/lib/session';
import { NotFound, RequireModule, RequireSession } from '@/routes/guards';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fleet data changes on human timescales, not by the second. A short
      // stale time keeps navigation instant without showing yesterday's numbers.
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // 4xx means the request was wrong, not unlucky. Retrying a 403 just
        // produces three log lines instead of one.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

            {/* Authenticated */}
            <Route element={<RequireSession />}>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />

                {/* No RequireModule: a notification is addressed to a person,
                    not to a module, so every role has a centre of their own. */}
                <Route path="notifications" element={<NotificationsPage />} />

                <Route element={<RequireModule module="users" />}>
                  <Route path="users" element={<UsersPage />} />
                </Route>

                <Route element={<RequireModule module="drivers" />}>
                  <Route path="drivers" element={<DriversPage />} />
                </Route>

                <Route element={<RequireModule module="vehicles" />}>
                  <Route path="vehicles" element={<VehiclesPage />} />
                  <Route path="vehicles/:id" element={<VehicleDetailPage />} />
                </Route>

                <Route element={<RequireModule module="maintenance" />}>
                  <Route path="maintenance" element={<MaintenancePage />} />
                  <Route path="maintenance/plans" element={<MaintenancePlansPage />} />
                </Route>

                <Route element={<RequireModule module="documents" />}>
                  <Route path="documents" element={<DocumentsPage />} />
                </Route>

                <Route element={<RequireModule module="damages" />}>
                  <Route path="damages" element={<DamagesPage />} />
                </Route>

                <Route element={<RequireModule module="reports" />}>
                  <Route path="reports" element={<ReportsPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>

          {/*
            Toasts inherit the design system rather than shipping their own
            palette: `richColors` would paint its own greens and reds, which
            would be the only colours in the product not coming from a token —
            and the only ones that would not follow the theme.

            They sit at the bottom rather than the top-right, which is where the
            notification bell and the sign-out button are: a toast landing under
            the cursor on its way to those is dismissed by accident. Sonner
            widens them to the full screen below 600px on its own.
          */}
          <Toaster
            position="bottom-right"
            offset={16}
            mobileOffset={12}
            duration={5000}
            toastOptions={{
              classNames: {
                toast:
                  'rounded-xl! border! border-border! bg-card! text-foreground! shadow-lg! font-sans!',
                title: 'text-sm! font-medium!',
                description: 'text-sm! text-muted-foreground!',
                success: '[--normal-text:var(--color-success)] border-success/30!',
                error: '[--normal-text:var(--color-destructive)] border-destructive/30!',
                actionButton: 'bg-primary! text-primary-foreground!',
                closeButton: 'border-border! bg-card! text-muted-foreground!',
              },
            }}
          />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
