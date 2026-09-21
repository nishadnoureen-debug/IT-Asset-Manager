'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FilterBar } from '@/components/filter-bar';
import { EnumSelect, VendorSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import {
  Checkbox,
  Field,
  FormError,
  FormGrid,
  Input,
  Select,
  Textarea,
} from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { daysUntil, formatDate, formatMoney, label } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { License, Software } from '@/lib/types';
import { LicenseDialog } from '@/features/software/license-dialog';

const DEFAULTS = { tab: 'software', search: '', expiring: '', page: '1' };

function SoftwareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const mutation = useApiMutation<Record<string, unknown>>('post', '/software', ['/software']);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<{
    name: string;
    version: string;
    publisherId: string;
    category: string;
    description: string;
  }>();
  useEffect(() => {
    if (open) reset({ name: '', version: '', publisherId: '', category: '', description: '' });
  }, [open, reset]);
  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync(Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')));
      toast.success('Software added');
      onClose();
    } catch (e) {
      setError('root', {
        message:
          e instanceof ApiError
            ? e.code === 'CONFLICT'
              ? 'This software and version already exist.'
              : e.message
            : 'Save failed',
      });
    }
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add software"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Name" required error={errors.name?.message}>
            {(p) => <Input {...p} {...register('name', { required: 'Required' })} />}
          </Field>
          <Field label="Version">{(p) => <Input {...p} {...register('version')} />}</Field>
          <Field label="Publisher">
            {(p) => <VendorSelect {...p} placeholder="None" {...register('publisherId')} />}
          </Field>
          <Field label="Category">
            {(p) => <Input {...p} placeholder="e.g. Productivity" {...register('category')} />}
          </Field>
        </FormGrid>
        <Field label="Description">
          {(p) => <Textarea {...p} rows={2} {...register('description')} />}
        </Field>
      </form>
    </Dialog>
  );
}

function Utilization({ used, seats }: { used: number; seats: number | null }) {
  if (seats === null)
    return (
      <span className="tabular-nums">
        {used} <span className="text-slate-400">/ ∞</span>
      </span>
    );
  const pct = seats ? Math.min(100, Math.round((used / seats) * 100)) : 0;
  return (
    <div className="w-32">
      <div className="flex justify-between text-xs tabular-nums">
        <span>
          {used} / {seats}
        </span>
        <span className="text-slate-500">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
        <div
          className={`h-1.5 rounded-full ${used > seats ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function SoftwarePage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [dialog, setDialog] = useState<'software' | 'license' | null>(null);
  const software = useApi<Software[]>(params.tab === 'software' ? '/software' : null, {
    search: params.search,
    page: params.page,
    limit: 25,
  });
  const licenses = useApi<License[]>(
    params.tab === 'licenses' ? (params.expiring ? '/licenses/expiring' : '/licenses') : null,
    { search: params.search, page: params.page, limit: 25 },
  );

  const softwareColumns: Column<Software>[] = [
    {
      key: 'name',
      header: 'Software',
      cell: (s) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {s.name} {s.version && <span className="text-slate-500">{s.version}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {[s.publisher?.name, s.category].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    { key: 'licenses', header: 'Licences', cell: (s) => s.licenseCount ?? 0 },
    {
      key: 'seats',
      header: 'Seats used',
      cell: (s) => <Utilization used={s.usedSeats ?? 0} seats={s.totalSeats ?? null} />,
    },
  ];

  const licenseColumns: Column<License>[] = [
    {
      key: 'name',
      header: 'Licence',
      cell: (l) => (
        <div>
          <Link
            href={`/software/licenses/${l.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {l.name ?? l.software.name}
          </Link>
          <p className="text-xs text-slate-500">
            {[l.software.name, l.software.version].filter(Boolean).join(' ')} ·{' '}
            {label('licenseType', l.licenseType)}
          </p>
        </div>
      ),
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (l) => <Utilization used={l.usedSeats} seats={l.seats} />,
    },
    {
      key: 'expiry',
      header: 'Expires',
      cell: (l) => {
        const d = daysUntil(l.expiryDate);
        return l.expiryDate ? (
          <span className="inline-flex items-center gap-2">
            {formatDate(l.expiryDate)}
            {d !== null && d < 0 ? (
              <Badge tone="red">Expired</Badge>
            ) : d !== null && d <= 30 ? (
              <Badge tone="amber">{d}d</Badge>
            ) : null}
          </span>
        ) : (
          'Never'
        );
      },
    },
    { key: 'vendor', header: 'Vendor', cell: (l) => l.vendor?.name ?? '—', hideOnMobile: true },
    {
      key: 'cost',
      header: 'Cost',
      cell: (l) => formatMoney(l.cost, l.currency),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Software & licences"
        description="Catalogue, seat allocation and expiry. Allocation beyond the seat count is blocked unless a licence allows it."
        actions={
          <>
            {can('software.manage') && (
              <Button
                variant="secondary"
                onClick={() => setDialog('software')}
                icon={<Plus className="h-4 w-4" />}
              >
                Add software
              </Button>
            )}
            {can('license.manage') && (
              <Button onClick={() => setDialog('license')} icon={<Plus className="h-4 w-4" />}>
                Add licence
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="px-4 pt-3">
          <Tabs
            value={params.tab}
            onChange={(tab) => set({ tab, search: '' })}
            tabs={[
              { value: 'software', label: 'Software' },
              {
                value: 'licenses',
                label: 'Licences',
                hidden: !can('license.view', 'license.manage'),
              },
            ]}
          />
        </div>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Search…"
        >
          {params.tab === 'licenses' && (
            <div className="flex items-center">
              <Checkbox
                label="Expiring soon"
                checked={!!params.expiring}
                onChange={(e) => set({ expiring: e.target.checked ? '1' : '' })}
              />
            </div>
          )}
        </FilterBar>
        {params.tab === 'software' ? (
          <DataTable
            caption="Software"
            columns={softwareColumns}
            rows={software.data?.data}
            loading={software.isFetching}
            error={software.error}
            meta={software.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={<EmptyState title="No software yet" />}
          />
        ) : (
          <DataTable
            caption="Licences"
            columns={licenseColumns}
            rows={licenses.data?.data}
            loading={licenses.isFetching}
            error={licenses.error}
            onRowClick={(l) => router.push(`/software/licenses/${l.id}`)}
            meta={licenses.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={<EmptyState title="No licences" />}
          />
        )}
      </Card>
      <SoftwareDialog open={dialog === 'software'} onClose={() => setDialog(null)} />
      <LicenseDialog open={dialog === 'license'} onClose={() => setDialog(null)} />
    </>
  );
}
