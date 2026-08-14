/**
 * Users screen — FF-304, USR-01…04.
 *
 * Administrator-only. The route guard already refuses everyone else, and the
 * API refuses again independently — this screen assumes both and concerns
 * itself with the work.
 */

import type { User } from '@fleetflow/shared';
import { MailPlus, Pencil, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { BooleanBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { formatDateTime, humanise } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { reportMutationError, reportSuccess } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { useDeleteUser, useResendInvitation, useSetUserActive, useUsers } from './api';
import { UserFormDialog } from './user-form';

type PendingAction =
  { kind: 'deactivate' | 'activate' | 'delete' | 'invite'; user: User } | undefined;

export function UsersPage() {
  const { user: currentUser } = useSession();
  const list = useListState({ defaultSort: 'name:asc' });
  const { data, isFetching } = useUsers(list.queryParams);

  const [editing, setEditing] = useState<User | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction>();

  const setActive = useSetUserActive();
  const deleteUser = useDeleteUser();
  const resendInvitation = useResendInvitation();

  const columns: Array<Column<User>> = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
            aria-hidden
          >
            {row.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('')}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground lg:hidden">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      hideOnMobile: true,
      render: (row) => <span className="text-muted-foreground">{row.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      render: (row) => <Badge tone="info">{humanise(row.role)}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        // Three distinct states an administrator cares about, and they are not
        // the same question: invited-but-never-signed-in is not "inactive".
        !row.hasUsablePassword ? (
          <Badge dot tone="warning">
            Invited
          </Badge>
        ) : (
          <BooleanBadge value={row.isActive} trueLabel="Active" falseLabel="Deactivated" />
        ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      sortable: true,
      hideOnMobile: true,
      render: (row) => (
        <span className="tabular text-muted-foreground">{formatDateTime(row.lastLoginAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-px whitespace-nowrap text-right',
      render: (row) => {
        // The server refuses these too (409). Disabling them here explains why
        // before the click, rather than after.
        const isSelf = row.id === currentUser?.id;

        return (
          <div className="flex justify-end gap-1">
            {!row.hasUsablePassword ? (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Resend invitation"
                onClick={() => setPending({ kind: 'invite', user: row })}
              >
                <MailPlus className="size-4" />
                <span className="sr-only">Resend invitation to {row.name}</span>
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="icon-sm"
              title="Edit"
              onClick={() => {
                setEditing(row);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-4" />
              <span className="sr-only">Edit {row.name}</span>
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isSelf}
              title={
                isSelf
                  ? 'You cannot change your own account'
                  : row.isActive
                    ? 'Deactivate'
                    : 'Activate'
              }
              onClick={() =>
                setPending({ kind: row.isActive ? 'deactivate' : 'activate', user: row })
              }
            >
              {row.isActive ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
              <span className="sr-only">
                {row.isActive ? 'Deactivate' : 'Activate'} {row.name}
              </span>
            </Button>

            <Button
              variant="ghost-destructive"
              size="icon-sm"
              disabled={isSelf}
              title={isSelf ? 'You cannot delete your own account' : 'Delete'}
              onClick={() => setPending({ kind: 'delete', user: row })}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Delete {row.name}</span>
            </Button>
          </div>
        );
      },
    },
  ];

  async function runPending(): Promise<void> {
    if (!pending) return;
    const { kind, user } = pending;

    try {
      if (kind === 'delete') {
        await deleteUser.mutateAsync(user.id);
        reportSuccess(`${user.name} was deleted`);
      } else if (kind === 'invite') {
        const result = await resendInvitation.mutateAsync(user.id);
        if (result.invitationSent) reportSuccess(`Invitation resent to ${user.email}`);
        else reportMutationError(new Error('not sent'));
      } else {
        await setActive.mutateAsync({ id: user.id, active: kind === 'activate' });
        reportSuccess(
          kind === 'activate' ? `${user.name} was reactivated` : `${user.name} was deactivated`,
        );
      }
    } catch (error) {
      reportMutationError(error);
      throw error; // keeps the dialog open so the toast is readable
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Accounts that can sign in to FleetFlow."
        actions={
          <Button
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            Add user
          </Button>
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search users"
            placeholder="Search name or email"
            defaultValue={list.q}
            onSearch={list.setSearch}
          />
        }
        filters={
          <>
            <FilterSelect
              label="Filter by role"
              value={list.filter('role')}
              onChange={(value) => list.setFilter('role', value)}
            >
              <option value="">All roles</option>
              {['ADMIN', 'FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER'].map((role) => (
                <option key={role} value={role}>
                  {humanise(role)}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Filter by status"
              value={list.filter('isActive')}
              onChange={(value) => list.setFilter('isActive', value)}
            >
              <option value="">Active and deactivated</option>
              <option value="true">Active only</option>
              <option value="false">Deactivated only</option>
            </FilterSelect>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(row) => row.id}
        total={data?.total ?? 0}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.setPage}
        sort={list.sort}
        onSortChange={list.setSort}
        loading={isFetching}
        emptyTitle="No users match this view"
        emptyDescription="Try clearing the search or filters."
      />

      <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />

      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={(open) => !open && setPending(undefined)}
        title={confirmTitle(pending)}
        description={confirmDescription(pending)}
        confirmLabel={pending?.kind === 'invite' ? 'Resend' : 'Confirm'}
        destructive={pending?.kind === 'delete' || pending?.kind === 'deactivate'}
        onConfirm={runPending}
      />
    </>
  );
}

function confirmTitle(pending: PendingAction): string {
  switch (pending?.kind) {
    case 'delete':
      return `Delete ${pending.user.name}?`;
    case 'deactivate':
      return `Deactivate ${pending.user.name}?`;
    case 'activate':
      return `Reactivate ${pending.user.name}?`;
    case 'invite':
      return `Resend the invitation to ${pending.user.name}?`;
    default:
      return '';
  }
}

function confirmDescription(pending: PendingAction): string {
  switch (pending?.kind) {
    case 'delete':
      // USR-03's guarantee, said plainly — an administrator should not have to
      // guess whether deleting a user erases their maintenance history.
      return 'They will no longer appear in FleetFlow and will be signed out immediately. The maintenance and damage records they created stay, still attributed to them.';
    case 'deactivate':
      return 'They will be signed out immediately and will not be able to sign in again until reactivated. Nothing they created is removed.';
    case 'activate':
      return 'They will be able to sign in again with their existing password.';
    case 'invite':
      return 'Any earlier invitation link stops working, and a new one is emailed.';
    default:
      return '';
  }
}
