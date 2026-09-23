'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FilterBar } from '@/components/filter-bar';
import { EmployeePicker, EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatRelative, fullName, label, requestRef } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { AssetRequest, AssetType } from '@/lib/types';

const DEFAULTS = {
  search: '',
  status: '',
  priority: '',
  type: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: '1',
};

interface NewRequestValues {
  title: string;
  justification: string;
  type: string;
  priority: string;
  assetTypeId: string;
  quantity: string;
  neededBy: string;
}

function NewRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { can } = useAuth();
  const staff = can('request.edit');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const types = useApi<AssetType[]>(open ? '/asset-types' : null, { limit: 100 });
  const mutation = useApiMutation<Record<string, unknown>, AssetRequest>('post', '/requests', [
    '/requests',
  ]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<NewRequestValues>();

  useEffect(() => {
    if (open) {
      reset({
        title: '',
        justification: '',
        type: 'NEW_ASSET',
        priority: 'MEDIUM',
        assetTypeId: '',
        quantity: '1',
        neededBy: '',
      });
      setEmployeeId(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { data } = await mutation.mutateAsync({
        title: v.title,
        justification: v.justification,
        type: v.type,
        priority: v.priority,
        quantity: Number(v.quantity) || 1,
        assetTypeId: v.assetTypeId || undefined,
        neededBy: v.neededBy || undefined,
        employeeId: employeeId ?? undefined,
      });
      toast.success(`Request ${requestRef(data.number)} submitted for approval`);
      onClose();
      router.push(`/requests/${data.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'title', { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Request an asset"
      description="Say what is needed and why. An approver decides, and the printed form is ready to sign."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Submit request
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <Field label="What do you need?" required error={errors.title?.message}>
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Laptop for new site engineer"
              {...register('title', {
                required: 'Required',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <Field label="Justification" required error={errors.justification?.message}>
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              placeholder="Why is it needed?"
              {...register('justification', {
                required: 'Required',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <FormGrid>
          <Field label="Request type">
            {(p) => <EnumSelect {...p} group="requestType" {...register('type')} />}
          </Field>
          <Field label="Item">
            {(p) => (
              <Select {...p} {...register('assetTypeId')}>
                <option value="">Not listed</option>
                {types.data?.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quantity" error={errors.quantity?.message}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={999}
                {...register('quantity', { min: { value: 1, message: 'At least 1' } })}
              />
            )}
          </Field>
          <Field label="Priority">
            {(p) => <EnumSelect {...p} group="priority" {...register('priority')} />}
          </Field>
          <Field label="Required by">
            {(p) => <Input {...p} type="date" {...register('neededBy')} />}
          </Field>
          {staff && (
            <Field label="For employee">
              {(p) => (
                <EmployeePicker
                  id={p.id}
                  value={employeeId}
                  onChange={setEmployeeId}
                  placeholder="Myself"
                />
              )}
            </Field>
          )}
        </FormGrid>
      </form>
    </Dialog>
  );
}

export default function RequestsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(useSearchParams().get('new') === '1');
  const approver = can('request.approve');
  const query = useApi<AssetRequest[]>('/requests', { ...params, limit: 25 });

  const columns: Column<AssetRequest>[] = [
    {
      key: 'title',
      header: 'Request',
      sort: 'number',
      cell: (r) => (
        <div className="min-w-0">
          <Link
            href={`/requests/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {r.title}
          </Link>
          <p className="text-xs text-slate-500">
            {requestRef(r.number)} · {label('requestType', r.type)}
            {r.quantity > 1 && ` · ×${r.quantity}`}
            {r.assetType && ` · ${r.assetType.name}`}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      cell: (r) => <StatusBadge group="requestStatus" value={r.status} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      sort: 'priority',
      cell: (r) => <StatusBadge group="priority" value={r.priority} />,
    },
    {
      key: 'employee',
      header: 'For',
      cell: (r) => (r.employee ? fullName(r.employee) : '—'),
      hideOnMobile: true,
    },
    {
      key: 'neededBy',
      header: 'Required by',
      sort: 'neededBy',
      cell: (r) => (r.neededBy ? formatDate(r.neededBy) : '—'),
      hideOnMobile: true,
    },
    {
      key: 'updated',
      header: 'Updated',
      sort: 'updatedAt',
      cell: (r) => formatRelative(r.updatedAt),
      hideOnMobile: true,
    },
  ];

  const waiting = query.data?.data.filter((r) => r.status === 'SUBMITTED').length ?? 0;

  return (
    <>
      <PageHeader
        title="Asset requests"
        description={
          approver
            ? 'Requests for equipment, waiting for your approval.'
            : 'Ask for equipment and follow your requests.'
        }
        actions={
          can('request.create') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              New request
            </Button>
          )
        }
      />
      {approver && waiting > 0 && !params.status && (
        <button
          type="button"
          onClick={() => set({ status: 'SUBMITTED' })}
          className="mb-4 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {waiting} request{waiting > 1 ? 's' : ''} waiting for approval — show them
        </button>
      )}
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Title or REQ number…"
          showReset={!!(params.search || params.status || params.priority || params.type)}
          onReset={() => set({ search: '', status: '', priority: '', type: '' })}
        >
          <EnumSelect
            group="requestStatus"
            placeholder="Any status"
            value={params.status}
            onChange={(e) => set({ status: e.target.value })}
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
            group="requestType"
            placeholder="Any type"
            value={params.type}
            onChange={(e) => set({ type: e.target.value })}
            aria-label="Request type"
          />
        </FilterBar>
        <DataTable
          caption="Asset requests"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={
            <EmptyState
              title="No asset requests"
              description={
                can('request.create') ? 'Raise a request when someone needs equipment.' : undefined
              }
            />
          }
        />
      </Card>
      <NewRequestDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
