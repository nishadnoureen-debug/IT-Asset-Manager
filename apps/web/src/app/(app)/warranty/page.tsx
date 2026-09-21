'use client';

import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { VendorSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader, StatCard } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { daysUntil, formatDate, toDateInput } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { Ref } from '@/lib/types';

interface WarrantyRow {
  id: string;
  assetTag: string;
  name: string;
  status: string;
  serialNumber: string | null;
  warrantyStartDate: string | null;
  warrantyEndDate: string | null;
  warrantyCoverage: string | null;
  warrantyReference: string | null;
  warrantyProvider: Ref | null;
  assetType: { name: string };
  location: Ref | null;
}

const DEFAULTS = {
  state: 'expiring',
  search: '',
  providerId: '',
  sortBy: '',
  sortOrder: 'asc',
  page: '1',
};

function DaysLeft({ end }: { end: string | null }) {
  const d = daysUntil(end);
  if (d === null) return <span className="text-slate-400">—</span>;
  if (d < 0) return <Badge tone="gray">Expired {Math.abs(d)}d ago</Badge>;
  return <Badge tone={d <= 30 ? 'amber' : 'green'}>{d} days</Badge>;
}

function EditWarranty({ row, onClose }: { row: WarrantyRow; onClose: () => void }) {
  const toast = useToast();
  const mutation = useApiMutation<Record<string, unknown>>('patch', `/assets/${row.id}/warranty`, [
    '/warranties',
    '/assets',
  ]);
  const [form, setForm] = useState({
    providerId: '',
    startDate: '',
    endDate: '',
    coverage: '',
    reference: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      providerId: row.warrantyProvider?.id ?? '',
      startDate: toDateInput(row.warrantyStartDate),
      endDate: toDateInput(row.warrantyEndDate),
      coverage: row.warrantyCoverage ?? '',
      reference: row.warrantyReference ?? '',
    });
  }, [row]);

  const save = async () => {
    try {
      await mutation.mutateAsync({
        providerId: form.providerId || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        coverage: form.coverage || null,
        reference: form.reference || null,
      });
      toast.success('Warranty updated');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Warranty — ${row.assetTag}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />
        <Field label="Provider">
          {(p) => (
            <VendorSelect
              {...p}
              placeholder="None"
              value={form.providerId}
              onChange={(e) => setForm({ ...form, providerId: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            )}
          </Field>
          <Field label="End">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Reference">
          {(p) => (
            <Input
              {...p}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          )}
        </Field>
        <Field label="Coverage">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={form.coverage}
              onChange={(e) => setForm({ ...form, coverage: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export default function WarrantyPage() {
  const { can } = useAuth();
  const { params, set } = useListParams(DEFAULTS);
  const [editing, setEditing] = useState<WarrantyRow | null>(null);
  const summary = useApi<{
    active: number;
    expiring: number;
    expired: number;
    none: number;
    alertDays: number;
  }>('/warranties/summary');
  const query = useApi<WarrantyRow[]>('/warranties', {
    ...params,
    sortBy: params.sortBy || undefined,
    limit: 25,
  });
  const s = summary.data?.data;

  const columns: Column<WarrantyRow>[] = [
    {
      key: 'asset',
      header: 'Asset',
      sort: 'assetTag',
      cell: (r) => (
        <div>
          <Link
            href={`/assets/${r.id}`}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {r.assetTag}
          </Link>
          <p className="text-xs text-slate-500">{r.name}</p>
        </div>
      ),
    },
    { key: 'provider', header: 'Provider', cell: (r) => r.warrantyProvider?.name ?? '—' },
    {
      key: 'reference',
      header: 'Reference',
      cell: (r) => r.warrantyReference ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'end',
      header: 'Ends',
      sort: 'warrantyEndDate',
      cell: (r) => formatDate(r.warrantyEndDate),
    },
    { key: 'left', header: 'Remaining', cell: (r) => <DaysLeft end={r.warrantyEndDate} /> },
    ...(can('warranty.edit')
      ? [
          {
            key: 'edit',
            header: <span className="sr-only">Edit</span>,
            cell: (r: WarrantyRow) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit warranty for ${r.assetTag}`}
                icon={<Pencil className="h-4 w-4" />}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(r);
                }}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Warranty"
        description="Coverage and expiry across all devices. Alerts are raised before warranties end."
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Under warranty" value={s?.active ?? '—'} tone="success" />
        <StatCard
          label={`Expiring in ${s?.alertDays ?? 30} days`}
          value={s?.expiring ?? '—'}
          tone={s?.expiring ? 'warning' : 'default'}
        />
        <StatCard label="Expired" value={s?.expired ?? '—'} />
        <StatCard label="No warranty recorded" value={s?.none ?? '—'} />
      </div>
      <Card>
        <div className="px-4 pt-3">
          <Tabs
            value={params.state}
            onChange={(state) => set({ state })}
            tabs={[
              { value: 'expiring', label: 'Expiring soon', count: s?.expiring },
              { value: 'active', label: 'Active', count: s?.active },
              { value: 'expired', label: 'Expired', count: s?.expired },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Tag, name, serial, reference…"
        >
          <VendorSelect
            placeholder="All providers"
            value={params.providerId}
            onChange={(e) => set({ providerId: e.target.value })}
            aria-label="Provider"
          />
        </FilterBar>
        <DataTable
          caption="Warranties"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={<EmptyState title="Nothing in this view" />}
        />
      </Card>
      {editing && <EditWarranty row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
