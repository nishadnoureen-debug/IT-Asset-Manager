'use client';

import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { formatDateTime } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import type { ActivityLog } from '@/lib/types';

const DEFAULTS = { search: '', entityType: '', from: '', to: '', page: '1' };

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function ActivityLogPage() {
  const { params, set } = useListParams(DEFAULTS);
  const [open, setOpen] = useState<ActivityLog | null>(null);
  const query = useApi<ActivityLog[]>('/activity-logs', {
    search: params.search,
    entityType: params.entityType,
    from: params.from ? new Date(params.from).toISOString() : undefined,
    to: params.to ? new Date(`${params.to}T23:59:59`).toISOString() : undefined,
    page: params.page,
    limit: 50,
  });

  const columns: Column<ActivityLog>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (l) => <span className="whitespace-nowrap">{formatDateTime(l.createdAt)}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (l) =>
        l.actor?.displayName ?? <span className="text-slate-400">System / anonymous</span>,
    },
    { key: 'action', header: 'Action', cell: (l) => <code className="text-xs">{l.action}</code> },
    {
      key: 'entity',
      header: 'Entity',
      cell: (l) => (
        <span className="text-xs">
          {l.entityType}
          {l.entityId && <span className="text-slate-400"> · {l.entityId.slice(0, 8)}</span>}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'ip',
      header: 'IP',
      cell: (l) => <span className="font-mono text-xs">{l.ipAddress ?? '—'}</span>,
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Append-only record of sensitive actions: who did what, when, from where, with before/after values."
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Action, entity or actor email…"
          showReset={!!(params.search || params.entityType || params.from || params.to)}
          onReset={() => set({ search: '', entityType: '', from: '', to: '' })}
        >
          <Input
            placeholder="Entity type, e.g. asset"
            value={params.entityType}
            onChange={(e) => set({ entityType: e.target.value })}
            aria-label="Entity type"
          />
          <Input
            type="date"
            value={params.from}
            onChange={(e) => set({ from: e.target.value })}
            aria-label="From"
          />
          <Input
            type="date"
            value={params.to}
            onChange={(e) => set({ to: e.target.value })}
            aria-label="To"
          />
        </FilterBar>
        <DataTable
          caption="Activity log"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRowClick={setOpen}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={<EmptyState title="No entries" />}
        />
      </Card>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(null)}
          title={open.action}
          description={formatDateTime(open.createdAt)}
          size="lg"
        >
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase text-slate-500">Actor</dt>
              <dd>{open.actor ? `${open.actor.displayName} (${open.actor.email})` : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Entity</dt>
              <dd className="font-mono text-xs">
                {open.entityType} {open.entityId}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Request</dt>
              <dd className="font-mono text-xs">
                {open.ipAddress ?? '—'} · {open.requestId ?? '—'}
              </dd>
              <dd className="text-xs text-slate-500">{open.userAgent}</dd>
            </div>
            <div>
              <dt className="mb-1 text-xs uppercase text-slate-500">Before</dt>
              <dd>
                <Json value={open.oldValues} />
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-xs uppercase text-slate-500">After</dt>
              <dd>
                <Json value={open.newValues} />
              </dd>
            </div>
          </dl>
        </Dialog>
      )}
    </>
  );
}
