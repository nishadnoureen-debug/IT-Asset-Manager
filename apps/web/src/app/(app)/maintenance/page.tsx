'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { MaintenanceDialog } from '@/features/maintenance/maintenance-form';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, label, maintenanceRef } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import type { MaintenanceRecord } from '@/lib/types';

const DEFAULTS = {
  search: '',
  status: '',
  priority: '',
  type: '',
  open: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: '1',
};

export default function MaintenancePage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useApi<MaintenanceRecord[]>('/maintenance', {
    ...params,
    open: params.open || undefined,
    limit: 25,
  });

  const columns: Column<MaintenanceRecord>[] = [
    {
      key: 'ref',
      header: 'Job',
      sort: 'number',
      cell: (m) => (
        <div className="min-w-0">
          <Link
            href={`/maintenance/${m.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {m.title}
          </Link>
          <p className="text-xs text-slate-500">
            {maintenanceRef(m.number)} · {label('maintenanceType', m.type)}
          </p>
        </div>
      ),
    },
    {
      key: 'asset',
      header: 'Asset',
      cell: (m) =>
        m.asset ? (
          <span>
            {m.asset.assetTag}
            <span className="block text-xs text-slate-500">{m.asset.name}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sort: 'priority',
      cell: (m) => <StatusBadge group="priority" value={m.priority} />,
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      cell: (m) => <StatusBadge group="maintenanceStatus" value={m.status} />,
    },
    {
      key: 'tech',
      header: 'Technician',
      cell: (m) => m.technician?.displayName ?? m.vendor?.name ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'date',
      header: 'Scheduled / started',
      sort: 'scheduledAt',
      cell: (m) => formatDate(m.startedAt ?? m.scheduledAt ?? m.createdAt),
      hideOnMobile: true,
    },
    {
      key: 'cost',
      header: 'Cost',
      cell: (m) => formatMoney(m.totalCost, m.currency),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Maintenance & repairs"
        description="Repairs, upgrades and preventive work, with technicians, vendors and costs."
        actions={
          can('maintenance.create') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              Log maintenance
            </Button>
          )
        }
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Title, asset tag…"
          showReset={
            !!(params.search || params.status || params.priority || params.type || params.open)
          }
          onReset={() => set({ search: '', status: '', priority: '', type: '', open: '' })}
        >
          <EnumSelect
            group="maintenanceStatus"
            placeholder="Any status"
            value={params.status}
            onChange={(e) => set({ status: e.target.value, open: '' })}
            aria-label="Status"
          />
          <EnumSelect
            group="priority"
            placeholder="Any priority"
            value={params.priority}
            onChange={(e) => set({ priority: e.target.value })}
            aria-label="Priority"
          />
          <EnumSelect
            group="maintenanceType"
            placeholder="Any type"
            value={params.type}
            onChange={(e) => set({ type: e.target.value })}
            aria-label="Type"
          />
          <div className="flex items-center">
            <Checkbox
              label="Open only"
              checked={params.open === 'true'}
              onChange={(e) => set({ open: e.target.checked ? 'true' : '', status: '' })}
            />
          </div>
        </FilterBar>
        <DataTable
          caption="Maintenance"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(m) => router.push(`/maintenance/${m.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={<EmptyState title="No maintenance records" />}
        />
      </Card>
      <MaintenanceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(m) => router.push(`/maintenance/${m.id}`)}
      />
    </>
  );
}
