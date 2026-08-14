/**
 * Vehicle list — FF-406, VEH-04.
 */

import type { Vehicle } from '@fleetflow/shared';
import { CarFront, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data-table';
import { FilterBar, FilterSelect, SearchInput } from '@/components/filter-bar';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Mono, PageHeader } from '@/components/ui/primitives';
import { formatMileage } from '@/lib/format';
import { useListState } from '@/lib/list-state';
import { useSession } from '@/lib/session';
import { useVehicles, useVehicleTypes } from './api';
import { VehicleFormDialog } from './vehicle-dialogs';

export function VehiclesPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const list = useListState({ defaultSort: 'plate:asc' });
  const { data, isFetching } = useVehicles(list.queryParams);
  const { data: types } = useVehicleTypes();
  const [formOpen, setFormOpen] = useState(false);

  const canCreate = can('vehicles', 'create');

  const columns: Array<Column<Vehicle>> = [
    {
      key: 'plate',
      header: 'Plate',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-3">
          {/* The plate is an identifier, so it is set in the mono face — the
              same treatment it gets everywhere else in the product. */}
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <CarFront className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <Mono className="block truncate font-medium">{row.plate}</Mono>
            <p className="truncate text-xs text-muted-foreground">
              {row.make} {row.model}
              {row.year ? ` · ${row.year}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      hideOnMobile: true,
      render: (row) => row.vehicleTypeName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'driver',
      header: 'Driver',
      render: (row) =>
        row.currentDriver ? (
          `${row.currentDriver.firstName} ${row.currentDriver.lastName}`
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
    {
      key: 'currentMileage',
      header: 'Odometer',
      sortable: true,
      hideOnMobile: true,
      render: (row) => <span className="tabular">{formatMileage(row.currentMileage)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Vehicles"
        description="Everything the fleet operates. Archived vehicles are hidden unless you ask for them."
        actions={
          canCreate ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="size-4" aria-hidden />
              Add vehicle
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        activeCount={list.activeFilterCount}
        onClear={list.clearFilters}
        search={
          <SearchInput
            label="Search vehicles"
            placeholder="Search plate, VIN, make or model"
            defaultValue={list.q}
            onSearch={list.setSearch}
          />
        }
        filters={
          <>
            <FilterSelect
              label="Filter by status"
              value={list.filter('status')}
              onChange={(value) => list.setFilter('status', value)}
            >
              <option value="">Active and in maintenance</option>
              <option value="ACTIVE">Active</option>
              <option value="UNDER_MAINTENANCE">Under maintenance</option>
              <option value="ARCHIVED">Archived</option>
            </FilterSelect>

            <FilterSelect
              label="Filter by type"
              value={list.filter('vehicleTypeId')}
              onChange={(value) => list.setFilter('vehicleTypeId', value)}
            >
              <option value="">All types</option>
              {(types?.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Filter by assignment"
              value={list.filter('unassigned')}
              onChange={(value) => list.setFilter('unassigned', value)}
            >
              <option value="">Assigned and unassigned</option>
              <option value="false">Has a driver</option>
              <option value="true">Unassigned</option>
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
        onRowClick={(row) => navigate(`/vehicles/${row.id}`)}
        emptyTitle="No vehicles match this view"
        emptyDescription="Try clearing the search or filters, or include archived vehicles."
      />

      <VehicleFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
