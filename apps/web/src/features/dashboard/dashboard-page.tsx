/**
 * Dashboard — FF-902 (DSH-01…08).
 *
 * The landing screen for all five roles. It renders what the server sent and
 * nothing else: a section arrives as `null` when the caller's role cannot see
 * it, so this file never re-decides a permission question the API has already
 * answered. Asking twice is how a UI ends up showing a card the API will refuse
 * to fill.
 *
 * Every counter is a link, and the query string behind it comes from the
 * server alongside the number — see `drillThrough`.
 *
 * The layout is ordered by urgency rather than by module. The counters that
 * mean "someone must act today" come first and carry the only colour on the
 * screen; the panels below say what those numbers are about; the cost chart
 * comes last, because nobody starts their morning with it.
 */

import type { Dashboard, DashboardCounter } from '@fleetflow/shared';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CarFront,
  CircleAlert,
  FileWarning,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeader,
} from '@/components/ui/primitives';
import { formatDate, formatMileage, formatMoney, formatRelativeDays } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { drillThrough, useDashboard } from './api';
import { CostChart } from './cost-chart';

export function DashboardPage() {
  const { user } = useSession();
  const { data, isPending, isError, error } = useDashboard();

  if (isPending) return <LoadingState label="Loading your dashboard…" />;

  if (isError) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <ErrorState
            title="The dashboard could not be loaded"
            {...(error instanceof Error ? { description: error.message } : {})}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={greeting()}
        title={`${user?.name.split(' ')[0] ?? 'Welcome'}`.trim()}
        description={describeScope(data)}
      />

      <div className="space-y-5">
        <CounterRow dashboard={data} />

        <div className="grid gap-5 xl:grid-cols-2">
          {data.maintenance ? <MaintenancePreview maintenance={data.maintenance} /> : null}
          {data.documents ? <DocumentPreview documents={data.documents} /> : null}
        </div>

        <div className={cn('grid gap-5', data.cost && 'xl:grid-cols-[3fr_2fr]')}>
          {data.cost ? (
            <Card>
              <SectionHeader
                title="Maintenance cost"
                description={`${formatMoney(data.cost.currentMonthTotal)} this month · ${formatMoney(
                  data.cost.total,
                )} over ${data.cost.months.length} months`}
              />
              <CardContent>
                <CostChart cost={data.cost} />
              </CardContent>
            </Card>
          ) : null}

          <RecentNotifications notifications={data.recentNotifications} />
        </div>
      </div>
    </>
  );
}

/** Time of day, because "Welcome" at 6am and at 6pm should not read the same. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A one-line honest statement of what the numbers cover.
 *
 * A Driver sees counts of one vehicle and a Mechanic counts of their own queue.
 * Without saying so, both look like fleet totals that happen to be very small.
 */
function describeScope(dashboard: Dashboard): string {
  if (!dashboard.vehicles && !dashboard.maintenance) return 'Your notifications.';
  if (dashboard.cost) return 'Your fleet at a glance.';
  if (dashboard.maintenance && !dashboard.vehicles) return 'The work assigned to you.';
  return 'Your vehicle and the work on it.';
}

// ---------------------------------------------------------------------------
// DSH-01…06 — the counters
// ---------------------------------------------------------------------------

function CounterRow({ dashboard }: { dashboard: Dashboard }) {
  const tiles: React.ReactNode[] = [];

  if (dashboard.vehicles) {
    tiles.push(
      <CounterTile
        key="total"
        label="Total vehicles"
        icon={CarFront}
        counter={dashboard.vehicles.total}
        to="/vehicles"
      />,
      <CounterTile
        key="active"
        label="Active"
        icon={CarFront}
        tone="success"
        counter={dashboard.vehicles.active}
        to="/vehicles"
      />,
      <CounterTile
        key="under"
        label="Under maintenance"
        icon={Wrench}
        tone="warning"
        counter={dashboard.vehicles.underMaintenance}
        to="/vehicles"
      />,
    );
  }

  if (dashboard.maintenance) {
    tiles.push(
      <CounterTile
        key="upcoming"
        label="Upcoming maintenance"
        hint={`within ${dashboard.maintenance.noticeDays} days`}
        icon={Wrench}
        tone="info"
        counter={dashboard.maintenance.upcoming}
        to="/maintenance"
      />,
      <CounterTile
        key="overdue"
        label="Overdue maintenance"
        icon={AlertTriangle}
        tone="danger"
        counter={dashboard.maintenance.overdue}
        to="/maintenance"
      />,
    );
  }

  if (dashboard.documents) {
    tiles.push(
      <CounterTile
        key="expiring"
        label="Expiring documents"
        icon={FileWarning}
        tone="warning"
        counter={dashboard.documents.expiring}
        to="/documents"
      />,
      <CounterTile
        key="expired"
        label="Expired documents"
        icon={CircleAlert}
        tone="danger"
        counter={dashboard.documents.expired}
        to="/documents"
      />,
    );
  }

  if (tiles.length === 0) return null;

  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tiles}</div>;
}

/**
 * A counter's colour is earned, not decorative.
 *
 * Only a number that means "act" is coloured, and only when it is non-zero:
 * zero overdue jobs is good news, and painting the zero red would teach people
 * to ignore red. `neutral` is the default because most numbers are just facts.
 */
const TONES = {
  neutral: { value: 'text-foreground', chip: 'bg-muted text-muted-foreground' },
  success: { value: 'text-foreground', chip: 'bg-success-soft text-success' },
  warning: { value: 'text-warning', chip: 'bg-warning-soft text-warning' },
  danger: { value: 'text-destructive', chip: 'bg-destructive-soft text-destructive' },
  info: { value: 'text-foreground', chip: 'bg-primary-soft text-primary' },
} as const;

function CounterTile({
  label,
  hint,
  icon: Icon,
  counter,
  to,
  tone = 'neutral',
}: {
  label: string;
  hint?: string;
  icon: LucideIcon;
  counter: DashboardCounter;
  to: string;
  tone?: keyof typeof TONES;
}) {
  const alarming = counter.value > 0 && (tone === 'danger' || tone === 'warning');
  const styles = TONES[tone];

  return (
    <Link
      to={drillThrough(to, counter)}
      className={cn(
        'group relative flex items-start justify-between gap-3 overflow-hidden rounded-xl border bg-card p-5 shadow-sm',
        'transition-[border-color,box-shadow,transform] duration-200',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
        alarming ? 'border-destructive/25' : 'border-border',
      )}
    >
      {/* A hairline along the top edge, coloured only when the number demands
          attention. It is the fastest thing to read on the whole screen. */}
      {alarming ? (
        <span
          className={cn(
            'absolute inset-x-0 top-0 h-0.5',
            tone === 'danger' ? 'bg-destructive' : 'bg-warning',
          )}
          aria-hidden
        />
      ) : null}

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-2 text-3xl font-semibold tabular leading-none',
            alarming ? styles.value : 'text-foreground',
          )}
        >
          {counter.value}
        </p>
        {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
      </div>

      <span className="flex flex-col items-end gap-3">
        <span
          className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', styles.chip)}
        >
          <Icon className="size-4.5" aria-hidden />
        </span>
        <ArrowUpRight
          className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// DSH-04, DSH-05 — what the numbers are about
// ---------------------------------------------------------------------------

/** "View all", in the one style every panel on this screen uses. */
function ViewAll({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary-hover"
    >
      View all
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function MaintenancePreview({
  maintenance,
}: {
  maintenance: NonNullable<Dashboard['maintenance']>;
}) {
  return (
    <Card className="flex flex-col">
      <SectionHeader
        icon={Wrench}
        title="Needing attention"
        description="Open work that is due or already late."
        action={<ViewAll to="/maintenance" />}
      />
      <div className="flex-1 border-t border-border">
        {maintenance.preview.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Nothing due"
            description="No open work is due or overdue."
          />
        ) : (
          <ul className="divide-y divide-border">
            {maintenance.preview.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/maintenance?vehicleId=${item.vehicleId}`}
                  className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{item.plate}</span>
                      {' · '}
                      {item.dueDate
                        ? `due ${formatDate(item.dueDate)} (${formatRelativeDays(item.dueDate)})`
                        : `due at ${formatMileage(item.dueMileage)}, now ${formatMileage(item.currentMileage)}`}
                    </p>
                  </div>
                  <Badge dot tone={item.status === 'OVERDUE' ? 'danger' : 'info'}>
                    {item.status === 'OVERDUE' ? 'Overdue' : 'Due soon'}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DSH-06
// ---------------------------------------------------------------------------

function DocumentPreview({ documents }: { documents: NonNullable<Dashboard['documents']> }) {
  return (
    <Card className="flex flex-col">
      <SectionHeader
        icon={FileWarning}
        title="Documents"
        description="Anything approaching or past its expiry date."
        action={<ViewAll to="/documents" />}
      />
      <div className="flex-1 border-t border-border">
        {documents.preview.length === 0 ? (
          <EmptyState
            icon={FileWarning}
            title="All valid"
            description="No document is expiring or expired."
          />
        ) : (
          <ul className="divide-y divide-border">
            {documents.preview.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/documents?vehicleId=${item.vehicleId}`}
                  className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.typeLabel}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{item.plate}</span> · expires{' '}
                      {formatDate(item.expiryDate)} ({formatRelativeDays(item.expiryDate)})
                    </p>
                  </div>
                  <Badge dot tone={item.status === 'EXPIRED' ? 'danger' : 'warning'}>
                    {item.status === 'EXPIRED' ? 'Expired' : 'Expiring'}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DSH-07
// ---------------------------------------------------------------------------

function RecentNotifications({
  notifications,
}: {
  notifications: Dashboard['recentNotifications'];
}) {
  return (
    <Card className="flex flex-col">
      <SectionHeader
        icon={Bell}
        title="Recent notifications"
        action={<ViewAll to="/notifications" />}
      />
      <div className="flex-1 border-t border-border">
        {notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Reminders appear here as maintenance falls due and documents approach expiry."
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex items-start gap-3 px-5 py-3.5">
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    notification.readAt ? 'bg-border-strong' : 'bg-primary',
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      'truncate text-sm',
                      notification.readAt ? 'text-muted-foreground' : 'font-semibold',
                    )}
                  >
                    {notification.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {notification.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
