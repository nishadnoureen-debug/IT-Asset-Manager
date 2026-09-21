'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { DepartmentSelect, EnumSelect, LocationSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { auditRef, formatDate } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { AuditSession } from '@/lib/types';

const DEFAULTS = { status: '', search: '', page: '1' };

function NewAuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const mutation = useApiMutation<Record<string, unknown>, AuditSession>('post', '/audits', [
    '/audits',
  ]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<{
    name: string;
    locationId: string;
    departmentId: string;
    scheduledAt: string;
    notes: string;
  }>();
  useEffect(() => {
    if (open) reset({ name: '', locationId: '', departmentId: '', scheduledAt: '', notes: '' });
  }, [open, reset]);
  const onSubmit = handleSubmit(async (v) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== ''),
    );
    if (body.scheduledAt) body.scheduledAt = new Date(body.scheduledAt as string).toISOString();
    try {
      const { data } = await mutation.mutateAsync(body);
      toast.success('Audit created');
      onClose();
      router.push(`/audits/${data.id}`);
    } catch (e) {
      setError('root', { message: e instanceof ApiError ? e.message : 'Save failed' });
    }
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New inventory audit"
      description="Choose a location and/or department. Expected assets are snapshotted when the audit starts."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <Field label="Name" required error={errors.name?.message}>
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Q4 head office audit"
              {...register('name', {
                required: 'Required',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <FormGrid>
          <Field label="Location" hint="Includes sub-locations">
            {(p) => (
              <LocationSelect {...p} placeholder="All locations" {...register('locationId')} />
            )}
          </Field>
          <Field label="Department">
            {(p) => (
              <DepartmentSelect
                {...p}
                placeholder="All departments"
                {...register('departmentId')}
              />
            )}
          </Field>
          <Field label="Scheduled for">
            {(p) => <Input {...p} type="date" {...register('scheduledAt')} />}
          </Field>
        </FormGrid>
        <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

export default function AuditsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useApi<AuditSession[]>('/audits', { ...params, limit: 25 });

  const columns: Column<AuditSession>[] = [
    {
      key: 'name',
      header: 'Audit',
      cell: (a) => (
        <div>
          <Link
            href={`/audits/${a.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {a.name}
          </Link>
          <p className="text-xs text-slate-500">
            {auditRef(a.number)} ·{' '}
            {[a.location?.name, a.department?.name].filter(Boolean).join(' · ') || 'All assets'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => <StatusBadge group="auditStatus" value={a.status} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (a) => {
        const s = a.summary;
        if (!s.total) return <span className="text-slate-400">Not started</span>;
        const scanned = s.total - s.PENDING;
        return (
          <span className="text-sm tabular-nums">
            {scanned}/{s.total} checked
            {s.MISSING + s.UNEXPECTED + s.WRONG_LOCATION + s.DAMAGED > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                {' '}
                · {s.MISSING + s.UNEXPECTED + s.WRONG_LOCATION + s.DAMAGED} issues
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'date',
      header: 'Date',
      cell: (a) => formatDate(a.startedAt ?? a.scheduledAt ?? a.createdAt),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Inventory audits"
        description="Scan assets on site and compare what is there with what should be."
        actions={
          can('audit.create') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              New audit
            </Button>
          )
        }
      />
      <Card>
        <div className="flex gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
          <EnumSelect
            group="auditStatus"
            placeholder="Any status"
            className="sm:w-48"
            value={params.status}
            onChange={(e) => set({ status: e.target.value })}
            aria-label="Status"
          />
        </div>
        <DataTable
          caption="Audits"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRowClick={(a) => router.push(`/audits/${a.id}`)}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={<EmptyState title="No audits yet" />}
        />
      </Card>
      <NewAuditDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
