'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, fullName } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import {
  SimCardDialog,
  SimPlanDialog,
  SimUsageDialog,
  CHARGE_FIELDS,
} from '@/features/sims/sim-dialogs';
import type { SimCard, SimPlan, SimUsage, SimUsageTotals } from '@/lib/types';

type Tab = 'cards' | 'plans' | 'usage';

const DEFAULTS = {
  tab: 'cards',
  search: '',
  status: '',
  month: '',
  sortBy: 'phoneNumber',
  sortOrder: 'asc',
  page: '1',
};

/** "2026-09" for the month picker, defaulting to this month. */
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function SimsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { params, set } = useListParams(DEFAULTS);
  const tab = (params.tab as Tab) || 'cards';
  const manage = can('sim.manage');

  const [editingCard, setEditingCard] = useState<SimCard | 'new' | null>(null);
  const [editingPlan, setEditingPlan] = useState<SimPlan | 'new' | null>(null);
  const [editingUsage, setEditingUsage] = useState<SimUsage | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: 'card' | 'plan';
    id: string;
    name: string;
  } | null>(null);

  const month = params.month || thisMonth();
  const cards = useApi<SimCard[]>(tab === 'cards' ? '/sim-cards' : null, {
    search: params.search,
    status: params.status || undefined,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    page: params.page,
    limit: 25,
  });
  const plans = useApi<SimPlan[]>(tab === 'plans' ? '/sim-plans' : null, {
    search: params.search,
    limit: 100,
  });
  const usage = useApi<SimUsage[]>(tab === 'usage' ? '/sim-usages' : null, {
    period: `${month}-01`,
    search: params.search,
    page: params.page,
    limit: 50,
  });
  // The API adds column totals to the paging meta of /sim-usages.
  const totals = usage.data?.meta as { totals?: SimUsageTotals } | undefined;

  const remove = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/${deleting.kind === 'card' ? 'sim-cards' : 'sim-plans'}/${deleting.id}`);
      toast.success(`${deleting.name} removed`);
      void cards.refetch();
      void plans.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setDeleting(null);
    }
  };

  const cardColumns: Column<SimCard>[] = [
    {
      key: 'phoneNumber',
      header: 'Number',
      sort: 'phoneNumber',
      cell: (c) => (
        <div className="min-w-0">
          <Link
            href={`/sims/${c.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {c.phoneNumber}
          </Link>
          <p className="truncate text-xs text-slate-500">
            {[c.provider, c.simNumber].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    { key: 'plan', header: 'Rate plan', cell: (c) => c.plan?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      sort: 'status',
      cell: (c) => <StatusBadge group="simStatus" value={c.status} />,
    },
    {
      key: 'employee',
      header: 'Used by',
      cell: (c) => (c.employee ? fullName(c.employee) : '—'),
      hideOnMobile: true,
    },
    {
      key: 'device',
      header: 'Device',
      cell: (c) => c.asset?.assetTag ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'latest',
      header: 'Latest month',
      cell: (c) =>
        c.usages?.length ? (
          <span className="whitespace-nowrap tabular-nums">
            {formatMoney(c.usages[0].totalCharge, c.usages[0].currency)}
            <span className="ml-1 text-xs text-slate-500">{formatDate(c.usages[0].period)}</span>
          </span>
        ) : (
          '—'
        ),
      hideOnMobile: true,
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (c: SimCard) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${c.phoneNumber}`}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCard(c);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${c.phoneNumber}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting({ kind: 'card', id: c.id, name: c.phoneNumber });
                  }}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const planColumns: Column<SimPlan>[] = [
    {
      key: 'name',
      header: 'Rate plan',
      cell: (p) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
          <p className="truncate text-xs text-slate-500">{p.provider ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'monthlyCharge',
      header: 'Monthly charges',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.monthlyCharge, p.currency)}</span>,
    },
    { key: 'sims', header: 'SIMs', cell: (p) => p._count?.simCards ?? 0, hideOnMobile: true },
    {
      key: 'remarks',
      header: 'Remarks',
      cell: (p) => p.remarks ?? '—',
      hideOnMobile: true,
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (p: SimPlan) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${p.name}`}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => setEditingPlan(p)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${p.name}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setDeleting({ kind: 'plan', id: p.id, name: p.name })}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const usageColumns: Column<SimUsage>[] = [
    {
      key: 'sim',
      header: 'Number',
      cell: (u) => (
        <div className="min-w-0">
          <Link
            href={`/sims/${u.simCardId}`}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {u.simCard?.phoneNumber}
          </Link>
          <p className="truncate text-xs text-slate-500">
            {u.simCard?.employee ? fullName(u.simCard.employee) : 'Unassigned'}
          </p>
        </div>
      ),
    },
    { key: 'plan', header: 'Rate plan', cell: (u) => u.plan?.name ?? '—', hideOnMobile: true },
    ...CHARGE_FIELDS.map((field) => ({
      key: field.key,
      header: field.label,
      cell: (u: SimUsage) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatMoney(u[field.key], u.currency)}
        </span>
      ),
      hideOnMobile: field.key !== 'monthlyCharge',
    })),
    {
      key: 'totalCharge',
      header: 'Total',
      sort: 'totalCharge',
      cell: (u) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatMoney(u.totalCharge, u.currency)}
        </span>
      ),
    },
    { key: 'remarks', header: 'Remarks', cell: (u) => u.remarks ?? '—', hideOnMobile: true },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (u: SimUsage) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit ${u.simCard?.phoneNumber} ${formatDate(u.period)}`}
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => setEditingUsage(u)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="SIM cards"
        description="Company lines, their rate plans and what they cost each month."
        actions={
          manage && (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => (tab === 'plans' ? setEditingPlan('new') : setEditingCard('new'))}
            >
              {tab === 'plans' ? 'New rate plan' : 'New SIM'}
            </Button>
          )
        }
      />
      <div className="mb-6">
        <Tabs<Tab>
          value={tab}
          onChange={(value) => set({ tab: value, page: '1', search: '' })}
          tabs={[
            { value: 'cards', label: 'SIM cards' },
            { value: 'plans', label: 'Rate plans' },
            { value: 'usage', label: 'Monthly usage' },
          ]}
        />
      </div>

      {tab === 'cards' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Number, ICCID or provider…"
            showReset={!!(params.search || params.status)}
            onReset={() => set({ search: '', status: '' })}
          >
            <EnumSelect
              group="simStatus"
              placeholder="Any status"
              value={params.status}
              onChange={(e) => set({ status: e.target.value })}
              aria-label="Status"
            />
          </FilterBar>
          <DataTable
            caption="SIM cards"
            columns={cardColumns}
            rows={cards.data?.data}
            loading={cards.isFetching}
            error={cards.error}
            onRetry={() => void cards.refetch()}
            onRowClick={(c) => router.push(`/sims/${c.id}`)}
            sortBy={params.sortBy}
            sortOrder={params.sortOrder as 'asc' | 'desc'}
            onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
            meta={cards.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={
              <EmptyState
                title="No SIM cards"
                description={manage ? 'Add the company lines to track their charges.' : undefined}
              />
            }
          />
        </Card>
      )}

      {tab === 'plans' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Plan or provider…"
            showReset={!!params.search}
            onReset={() => set({ search: '' })}
          />
          <DataTable
            caption="Rate plans"
            columns={planColumns}
            rows={plans.data?.data}
            loading={plans.isFetching}
            error={plans.error}
            onRetry={() => void plans.refetch()}
            empty={
              <EmptyState
                title="No rate plans"
                description={manage ? 'Add the plans your carrier bills you for.' : undefined}
              />
            }
          />
        </Card>
      )}

      {tab === 'usage' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Number…"
            showReset={!!(params.search || params.month)}
            onReset={() => set({ search: '', month: '' })}
          >
            <Input
              type="month"
              aria-label="Billing month"
              value={month}
              onChange={(e) => set({ month: e.target.value, page: '1' })}
            />
          </FilterBar>
          <DataTable
            caption="Monthly usage"
            columns={usageColumns}
            rows={usage.data?.data}
            loading={usage.isFetching}
            error={usage.error}
            onRetry={() => void usage.refetch()}
            meta={usage.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={
              <EmptyState
                title="Nothing recorded for this month"
                description={
                  manage ? 'Open a SIM card and record the month from its bill.' : undefined
                }
              />
            }
          />
          {totals?.totals && (
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-slate-100 px-5 py-3 text-sm dark:border-slate-800">
              {CHARGE_FIELDS.map((field) => (
                <span key={field.key} className="text-slate-500">
                  {field.label}:{' '}
                  <span className="tabular-nums text-slate-900 dark:text-slate-100">
                    {formatMoney(totals.totals![field.key])}
                  </span>
                </span>
              ))}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                Total:{' '}
                <span className="tabular-nums">{formatMoney(totals.totals.totalCharge)}</span>
              </span>
            </div>
          )}
        </Card>
      )}

      <SimCardDialog
        open={editingCard !== null}
        card={editingCard === 'new' ? null : editingCard}
        onClose={() => setEditingCard(null)}
      />
      <SimPlanDialog
        open={editingPlan !== null}
        plan={editingPlan === 'new' ? null : editingPlan}
        onClose={() => setEditingPlan(null)}
      />
      {editingUsage && (
        <SimUsageDialog
          open
          simCardId={editingUsage.simCardId}
          usage={editingUsage}
          onClose={() => setEditingUsage(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Remove ${deleting?.name ?? ''}?`}
        description="It is archived, so past months stay in the records."
        confirmLabel="Remove"
        danger
      />
    </>
  );
}
