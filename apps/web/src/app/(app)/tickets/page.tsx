'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FilterBar } from '@/components/filter-bar';
import { AssetPicker, EmployeePicker, EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatRelative, fullName, label, ticketRef } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { Ticket } from '@/lib/types';

const DEFAULTS = {
  search: '',
  status: '',
  priority: '',
  category: '',
  open: '',
  assignedToMe: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  page: '1',
};

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { can } = useAuth();
  const staff = can('ticket.edit');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [requesterId, setRequesterId] = useState<string | null>(null);
  const mutation = useApiMutation<Record<string, unknown>, Ticket>('post', '/tickets', [
    '/tickets',
  ]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<{ title: string; description: string; category: string; priority: string }>();

  useEffect(() => {
    if (open) {
      reset({ title: '', description: '', category: 'HARDWARE', priority: 'MEDIUM' });
      setAssetId(null);
      setRequesterId(null);
    }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { data } = await mutation.mutateAsync({
        ...v,
        assetId: assetId ?? undefined,
        requesterId: requesterId ?? undefined,
      });
      toast.success(`Ticket ${ticketRef(data.number)} created`);
      onClose();
      router.push(`/tickets/${data.id}`);
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
      title="Raise a ticket"
      description="Describe the problem — IT will pick it up."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Submit
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <Field label="Subject" required error={errors.title?.message}>
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Laptop won't charge"
              {...register('title', {
                required: 'Required',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <Field label="Details" required error={errors.description?.message}>
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              {...register('description', {
                required: 'Required',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <FormGrid>
          <Field label="Category">
            {(p) => <EnumSelect {...p} group="ticketCategory" {...register('category')} />}
          </Field>
          <Field label="Priority">
            {(p) => <EnumSelect {...p} group="priority" {...register('priority')} />}
          </Field>
          <Field label="Related asset">
            {(p) => (
              <AssetPicker id={p.id} value={assetId} onChange={setAssetId} placeholder="Optional" />
            )}
          </Field>
          {staff && (
            <Field label="On behalf of">
              {(p) => (
                <EmployeePicker
                  id={p.id}
                  value={requesterId}
                  onChange={setRequesterId}
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

export default function TicketsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(useSearchParams().get('new') === '1');
  const staff = can('ticket.view');
  const query = useApi<Ticket[]>('/tickets', {
    ...params,
    open: params.open || undefined,
    assignedToMe: params.assignedToMe || undefined,
    limit: 25,
  });

  const columns: Column<Ticket>[] = [
    {
      key: 'title',
      header: 'Ticket',
      sort: 'number',
      cell: (t) => (
        <div className="min-w-0">
          <Link
            href={`/tickets/${t.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {t.title}
          </Link>
          <p className="text-xs text-slate-500">
            {ticketRef(t.number)} · {label('ticketCategory', t.category)}
            {t.asset && ` · ${t.asset.assetTag}`}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      cell: (t) => <StatusBadge group="ticketStatus" value={t.status} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      sort: 'priority',
      cell: (t) => <StatusBadge group="priority" value={t.priority} />,
    },
    {
      key: 'requester',
      header: 'Requester',
      cell: (t) => (t.requester ? fullName(t.requester) : '—'),
      hideOnMobile: true,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      cell: (t) => t.assignee?.displayName ?? <span className="text-slate-400">Unassigned</span>,
      hideOnMobile: true,
    },
    {
      key: 'updated',
      header: 'Updated',
      sort: 'updatedAt',
      cell: (t) => formatRelative(t.updatedAt),
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="IT Helpdesk"
        description={staff ? 'Requests and incidents from employees.' : 'Your requests to IT.'}
        actions={
          can('ticket.create') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              New ticket
            </Button>
          )
        }
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Title or TCK number…"
          showReset={
            !!(
              params.search ||
              params.status ||
              params.priority ||
              params.category ||
              params.open ||
              params.assignedToMe
            )
          }
          onReset={() =>
            set({ search: '', status: '', priority: '', category: '', open: '', assignedToMe: '' })
          }
        >
          <EnumSelect
            group="ticketStatus"
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
            group="ticketCategory"
            placeholder="Any category"
            value={params.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Category"
          />
          <div className="flex items-center gap-4">
            <Checkbox
              label="Open"
              checked={params.open === 'true'}
              onChange={(e) => set({ open: e.target.checked ? 'true' : '', status: '' })}
            />
            {staff && (
              <Checkbox
                label="Mine"
                checked={params.assignedToMe === 'true'}
                onChange={(e) => set({ assignedToMe: e.target.checked ? 'true' : '' })}
              />
            )}
          </div>
        </FilterBar>
        <DataTable
          caption="Tickets"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(t) => router.push(`/tickets/${t.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={
            <EmptyState
              title="No tickets"
              description={
                can('ticket.create')
                  ? 'Raise a ticket when something needs IT’s attention.'
                  : undefined
              }
            />
          }
        />
      </Card>
      <NewTicketDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
