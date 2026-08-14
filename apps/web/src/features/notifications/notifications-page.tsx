/**
 * Notification centre — FF-805, NTF-06.
 *
 * Every notification exists to make somebody do something, so each one is a
 * link to the record it is about. A reminder you cannot act on from where you
 * read it is a reminder that gets deferred.
 *
 * Unread is carried by three signals at once — a tinted row, a bold title and a
 * dot in the gutter — because this is the one screen where "have I dealt with
 * this" is the only question being asked, and weight alone is too quiet to scan
 * a list of twenty by.
 */

import type { Notification } from '@fleetflow/shared';
import {
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  FileWarning,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, SegmentedControl, SegmentedItem } from '@/components/ui/button';
import {
  Badge,
  Card,
  EmptyState,
  LoadingState,
  PageHeader,
  Spinner,
} from '@/components/ui/primitives';
import { formatDateTime, humanise } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useMarkAllRead, useMarkRead, useNotifications, useRunNotifications } from './api';

/** The four rules, in the colours and marks their urgency deserves. */
const RULES = {
  MAINTENANCE_OVERDUE: { tone: 'danger', icon: Wrench },
  INSPECTION_DUE: { tone: 'warning', icon: CalendarClock },
  DOCUMENT_EXPIRING: { tone: 'warning', icon: FileWarning },
  MAINTENANCE_UPCOMING: { tone: 'info', icon: Wrench },
} as const;

export function NotificationsPage() {
  const { can } = useSession();
  const list = useListState();
  const { data, isFetching } = useNotifications(list.queryParams);

  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const runRules = useRunNotifications();

  // Running the rules is an operational action, tied to the same permission
  // that governs reports rather than to a module of its own.
  const canRun = can('reports', 'read');

  async function runNow(): Promise<void> {
    try {
      const result = await runRules.mutateAsync();
      reportSuccess(
        result.totalCreated === 0
          ? result.totalSkipped > 0
            ? 'Already sent today — nothing new'
            : 'Nothing is due'
          : `${result.totalCreated} notification(s) created`,
      );
      if (!result.emailEnabled && result.totalCreated > 0) {
        reportMutationError(
          new Error('Notifications were created, but email is not configured so nothing was sent.'),
        );
      }
    } catch (error) {
      reportMutationError(error);
    }
  }

  const unread = data?.unreadCount ?? 0;
  const unreadOnly = list.filter('unreadOnly') === 'true';

  return (
    <>
      <PageHeader
        eyebrow="Your inbox"
        title="Notifications"
        description="Reminders about maintenance, inspections and expiring documents."
        actions={
          <>
            {canRun ? (
              <Button variant="outline" onClick={() => void runNow()} disabled={runRules.isPending}>
                {runRules.isPending ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />}
                Check now
              </Button>
            ) : null}
            {unread > 0 ? (
              <Button
                onClick={() =>
                  void markAllRead
                    .mutateAsync()
                    .then((r) => reportSuccess(`${r.marked} marked as read`))
                    .catch(reportMutationError)
                }
              >
                <CheckCheck className="size-4" aria-hidden />
                Mark all read
              </Button>
            ) : null}
          </>
        }
      />

      {/* Two states, both shown. A filter you can see the alternative to is
          understood at a glance; one hidden behind a dropdown is not. */}
      <div className="mb-4 flex items-center gap-3">
        <SegmentedControl role="group" aria-label="Filter notifications">
          <SegmentedItem
            active={!unreadOnly}
            onClick={() => list.setFilter('unreadOnly', undefined)}
          >
            All
          </SegmentedItem>
          <SegmentedItem active={unreadOnly} onClick={() => list.setFilter('unreadOnly', 'true')}>
            Unread
            {unread > 0 ? (
              <span className="ml-0.5 rounded-full bg-destructive px-1.5 text-2xs font-semibold text-destructive-foreground">
                {unread}
              </span>
            ) : null}
          </SegmentedItem>
        </SegmentedControl>
      </div>

      {isFetching && !data ? (
        <LoadingState label="Loading notifications…" />
      ) : (data?.data.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
            description="Reminders appear here as maintenance falls due and documents approach their expiry."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {(data?.data ?? []).map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onRead={() => void markRead.mutateAsync(notification.id).catch(reportMutationError)}
              />
            ))}
          </ul>
        </Card>
      )}

      {(data?.total ?? 0) > list.pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular">
            Page {list.page} of {Math.ceil((data?.total ?? 0) / list.pageSize)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={list.page <= 1}
              onClick={() => list.setPage(list.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={list.page * list.pageSize >= (data?.total ?? 0)}
              onClick={() => list.setPage(list.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: () => void;
}) {
  const unread = notification.readAt === null;
  const rule = RULES[notification.rule];
  const Icon = rule.icon;

  // The link is absolute (it is built for email); inside the app only the path
  // is wanted, so React Router handles it without a page reload.
  const path = notification.linkUrl
    ? new URL(notification.linkUrl, window.location.origin).pathname +
      new URL(notification.linkUrl, window.location.origin).search
    : null;

  const content = (
    <div className="flex flex-1 items-start gap-3">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          rule.tone === 'danger'
            ? 'bg-destructive-soft text-destructive'
            : rule.tone === 'warning'
              ? 'bg-warning-soft text-warning'
              : 'bg-primary-soft text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('text-sm', unread ? 'font-semibold' : 'font-medium')}>
            {notification.title}
          </p>
          <Badge tone={rule.tone}>{humanise(notification.rule)}</Badge>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{notification.body}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {formatDateTime(notification.createdAt)}
        </p>
      </div>
    </div>
  );

  return (
    <li
      className={cn(
        'flex items-start gap-2 px-4 py-4 transition-colors sm:px-5',
        unread && 'bg-primary-soft/40',
      )}
    >
      {/* The unread rail. A dot in the gutter reads faster down a column than a
          weight change does, and it survives being seen peripherally. */}
      <span
        className={cn(
          'mt-4 size-1.5 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
        aria-hidden
      />

      {path ? (
        // Opening it counts as reading it — nobody should have to mark a
        // reminder read after acting on it.
        <Link
          to={path}
          onClick={unread ? onRead : undefined}
          className="flex flex-1 rounded-lg transition-opacity hover:opacity-80"
        >
          {content}
        </Link>
      ) : (
        content
      )}

      {unread ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="mt-1 shrink-0"
          title="Mark as read"
          onClick={onRead}
        >
          <BellOff className="size-4" />
          <span className="sr-only">Mark &ldquo;{notification.title}&rdquo; as read</span>
        </Button>
      ) : null}
    </li>
  );
}
