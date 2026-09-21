'use client';

import { Download, Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { DepartmentSelect, EnumSelect, LocationSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { daysUntil, formatDate, fullName } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import type { AssetListItem } from '@/lib/types';

const DEFAULTS = {
  search: '',
  status: '',
  category: '',
  locationId: '',
  departmentId: '',
  warranty: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: '1',
};

function WarrantyCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-slate-400">—</span>;
  const days = daysUntil(date)!;
  return (
    <span
      className={
        days < 0
          ? 'text-slate-400'
          : days <= 30
            ? 'font-medium text-amber-700 dark:text-amber-400'
            : undefined
      }
    >
      {formatDate(date)}
    </span>
  );
}

export default function AssetsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { params, set } = useListParams(DEFAULTS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const query = useApi<AssetListItem[]>('/assets', {
    search: params.search,
    status: params.status,
    category: params.category,
    locationId: params.locationId,
    departmentId: params.departmentId,
    warranty: params.warranty,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    page: params.page,
    limit: 25,
  });
  const rows = query.data?.data;
  const canLabel = can('qr.generate');

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: Column<AssetListItem>[] = [
    ...(canLabel
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                aria-label="Select all on this page"
                className="h-4 w-4 rounded border-slate-300"
                checked={!!rows?.length && rows.every((r) => selected.has(r.id))}
                onChange={(e) => {
                  const next = new Set(selected);
                  rows?.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
                  setSelected(next);
                }}
              />
            ),
            cell: (a: AssetListItem) => (
              <input
                type="checkbox"
                aria-label={`Select ${a.assetTag}`}
                className="h-4 w-4 rounded border-slate-300"
                checked={selected.has(a.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(a.id)}
              />
            ),
            className: 'w-10',
          },
        ]
      : []),
    {
      key: 'tag',
      header: 'Asset',
      sort: 'assetTag',
      cell: (a) => (
        <div className="min-w-0">
          <Link
            href={`/assets/${a.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
          >
            {a.assetTag}
          </Link>
          <p className="max-w-[16rem] truncate text-xs text-slate-500">{a.name}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (a) => a.assetType.name, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      cell: (a) => <StatusBadge group="assetStatus" value={a.status} />,
    },
    {
      key: 'holder',
      header: 'Assigned to',
      cell: (a) => {
        const current = a.assignments[0];
        if (!current) return <span className="text-slate-400">—</span>;
        return current.employee ? fullName(current.employee) : current.location?.name;
      },
    },
    {
      key: 'location',
      header: 'Location',
      cell: (a) => a.location?.name ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'serial',
      header: 'Serial',
      cell: (a) => <span className="font-mono text-xs">{a.serialNumber ?? '—'}</span>,
      hideOnMobile: true,
    },
    {
      key: 'warranty',
      header: 'Warranty',
      sort: 'warrantyEndDate',
      cell: (a) => <WarrantyCell date={a.warrantyEndDate} />,
      hideOnMobile: true,
    },
  ];

  const printLabels = async () => {
    setBusy(true);
    try {
      await downloadFile('/qr/labels', {
        query: { assetIds: [...selected] },
        fileName: 'asset-labels.pdf',
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      await downloadFile('/reports/assets', {
        query: {
          format: 'csv',
          status: params.status,
          locationId: params.locationId,
          departmentId: params.departmentId,
        },
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const filtered = Object.entries(params).some(
    ([k, v]) =>
      ['search', 'status', 'category', 'locationId', 'departmentId', 'warranty'].includes(k) && v,
  );

  return (
    <>
      <PageHeader
        title="Assets"
        description="Every device the company owns, from purchase to disposal."
        actions={
          <>
            {canLabel && selected.size > 0 && (
              <Button
                variant="secondary"
                onClick={printLabels}
                loading={busy}
                icon={<Printer className="h-4 w-4" />}
              >
                Print {selected.size} label{selected.size > 1 ? 's' : ''}
              </Button>
            )}
            {can('report.export') && (
              <Button
                variant="secondary"
                onClick={exportCsv}
                loading={busy}
                icon={<Download className="h-4 w-4" />}
              >
                Export
              </Button>
            )}
            {can('asset.create') && (
              <ButtonLink href="/assets/new" icon={<Plus className="h-4 w-4" />}>
                Add asset
              </ButtonLink>
            )}
          </>
        }
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Tag, name, serial, model…"
          showReset={filtered}
          onReset={() =>
            set({
              search: '',
              status: '',
              category: '',
              locationId: '',
              departmentId: '',
              warranty: '',
            })
          }
        >
          <EnumSelect
            group="assetStatus"
            placeholder="All statuses"
            value={params.status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Status"
          />
          <EnumSelect
            group="assetCategory"
            placeholder="All categories"
            value={params.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Category"
          />
          <LocationSelect
            placeholder="All locations"
            value={params.locationId}
            onChange={(e) => set({ locationId: e.target.value })}
            aria-label="Location"
          />
          <DepartmentSelect
            placeholder="All departments"
            value={params.departmentId}
            onChange={(e) => set({ departmentId: e.target.value })}
            aria-label="Department"
          />
          <Select
            value={params.warranty}
            onChange={(e) => set({ warranty: e.target.value })}
            aria-label="Warranty"
          >
            <option value="">Any warranty</option>
            <option value="active">Under warranty</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="none">No warranty</option>
          </Select>
        </FilterBar>
        <DataTable
          caption="Assets"
          columns={columns}
          rows={rows}
          loading={query.isLoading || query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(a) => router.push(`/assets/${a.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={
            <EmptyState
              title={filtered ? 'No assets match these filters' : 'No assets yet'}
              description={
                filtered
                  ? 'Try a different search or clear the filters.'
                  : 'Register your first device to start tracking it.'
              }
              action={
                !filtered && can('asset.create') ? (
                  <ButtonLink href="/assets/new" icon={<Plus className="h-4 w-4" />}>
                    Add asset
                  </ButtonLink>
                ) : undefined
              }
            />
          }
        />
      </Card>
    </>
  );
}
