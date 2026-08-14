/**
 * Application shell — FF-1101 / FF-1105.
 *
 * Sidebar, topbar, and the outlet every authenticated screen renders into.
 *
 * The navigation is derived from `visibleModules(role)` — the same MATRIX the
 * API enforces — so a Mechanic never sees a Drivers link and an Accountant
 * never sees Users. Nothing here is a security boundary: the server answers the
 * same question independently on every request. This only avoids showing people
 * doors that are locked.
 *
 * The entries are grouped rather than listed flat. Nine links in one column is
 * a menu you read; four short groups is a map you scan — and the groups say
 * something true about the product, which is that vehicles are the subject,
 * operations are what happens to them, and the rest is administration. A role
 * that can see nothing in a group never sees the group's heading either.
 */

import type { Module } from '@fleetflow/shared';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarClock,
  CarFront,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BrandLockup } from '@/components/ui/brand';
import { Button, SegmentedControl, SegmentedItem } from '@/components/ui/button';
import { useUnreadCount } from '@/features/notifications/api';
import { humanise } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Absent for entries everyone may see, such as the dashboard. */
  module?: Module;
}

interface NavGroup {
  /** Omitted for the first group; a heading above a single item is noise. */
  label?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    // Notifications are deliberately absent. They are not a module — they are
    // addressed to a person — so the bell in the topbar is their one entry
    // point, present for every role including the ones whose sidebar is nearly
    // empty. A second door to the same room would only make the bell ambiguous.
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles', icon: CarFront, module: 'vehicles' },
      { to: '/drivers', label: 'Drivers', icon: Users, module: 'drivers' },
      { to: '/documents', label: 'Documents', icon: FileText, module: 'documents' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, module: 'maintenance' },
      // Plans are the rules behind the jobs; only roles that can create work need them.
      { to: '/maintenance/plans', label: 'Plans', icon: CalendarClock, module: 'maintenance' },
      { to: '/damages', label: 'Damages', icon: AlertTriangle, module: 'damages' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports' },
      { to: '/users', label: 'Users', icon: ShieldCheck, module: 'users' },
    ],
  },
];

export function AppShell() {
  const { user, signOut, can } = useSession();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.module || can(item.module, 'read')),
  })).filter((group) => group.items.length > 0);

  // The drawer must close when navigation actually happens — including when it
  // happens from somewhere other than a nav link, such as a notification row.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // A drawer over the content must not leave the page behind it scrolling.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-background">
      {/* The first thing a keyboard user meets. Nine nav links stand between
          the top of the document and the content on every single page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-60 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Sidebar. Off-canvas below `lg` — drivers and mechanics use this on a
          phone, and a permanent sidebar would leave no room for content. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-68 flex-col border-r border-border bg-card',
          'transition-transform duration-300 ease-out lg:z-30 lg:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
          <BrandLockup tagline="Fleet operations" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close navigation</span>
          </Button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
          {groups.map((group, index) => (
            <div key={group.label ?? index}>
              {group.label ? (
                <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* The identity, at the foot of the navigation where it does not compete
            with the page's own actions. On a phone this is the only place it
            appears, since the topbar has no room for it. */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <Avatar name={user?.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{humanise(user?.role)}</p>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 animate-fade-in bg-overlay lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="lg:pl-68">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            <Menu className="size-5" aria-hidden />
            <span className="sr-only">Open navigation</span>
          </Button>

          {/* On a phone the sidebar is off-canvas, so the header carries the
              mark — otherwise the product has no name anywhere on screen. */}
          <BrandLockup className="lg:hidden" markClassName="size-7" />

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <NotificationBell />

            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />

            <div className="hidden items-center gap-2.5 sm:flex">
              <Avatar name={user?.name} className="size-8 text-xs" />
              <div className="hidden text-right leading-tight md:block">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{humanise(user?.role)}</p>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              {/* Always in the accessibility tree, visible from `sm` up: an
                  icon-only control with no name is unusable by voice or screen
                  reader, which is exactly the phone case. */}
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </Button>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[100rem] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
          'transition-colors duration-150',
          isActive
            ? 'bg-primary-soft text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* A rail on the active entry. Colour alone marks the current page
              weakly at a glance; a hard edge against the sidebar reads instantly
              and survives being seen out of the corner of an eye. */}
          <span
            className={cn(
              'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden
          />
          <item.icon
            className={cn(
              'size-4 shrink-0 transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
            )}
            aria-hidden
          />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

/** Initials, as a stand-in for the avatars the product does not store. */
function Avatar({ name, className }: { name?: string | undefined; className?: string }) {
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary',
        className,
      )}
      aria-hidden
    >
      {initials || '·'}
    </span>
  );
}

/**
 * The bell — NTF-06.
 *
 * Present for every role: a notification is addressed to a person, not to a
 * module, so a mechanic and a driver both need it as much as an administrator.
 */
function NotificationBell() {
  const { data } = useUnreadCount();
  const unread = data?.unreadCount ?? 0;

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <NavLink
        to="/notifications"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span
            // Capped at 9+: the exact number stops mattering past a handful,
            // and a three-digit badge stops fitting. Ringed in the header's own
            // colour so it reads as sitting on top of the bell rather than
            // being part of it.
            className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-semibold leading-4 text-destructive-foreground ring-2 ring-card"
            aria-hidden
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </NavLink>
    </Button>
  );
}

/**
 * Light / dark / system.
 *
 * Three states rather than a switch, because "follow my machine" is a real
 * answer and a two-state toggle silently takes it away the first time it is
 * touched. Collapsed to a single cycling button below `sm`, where a segmented
 * control of three would crowd out the sign-out button.
 */
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeToggle() {
  const { preference, resolved, setPreference, toggle } = useTheme();

  return (
    <>
      <SegmentedControl className="hidden sm:inline-flex" role="group" aria-label="Colour theme">
        {THEME_OPTIONS.map((option) => (
          <SegmentedItem
            key={option.value}
            active={preference === option.value}
            onClick={() => setPreference(option.value)}
            title={option.label}
          >
            <option.icon aria-hidden />
            <span className="sr-only">{option.label}</span>
          </SegmentedItem>
        ))}
      </SegmentedControl>

      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        onClick={toggle}
        aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {resolved === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </Button>
    </>
  );
}

/** Exported so the 404 screen can offer a way back without duplicating the icon set. */
export { X as CloseIcon };
