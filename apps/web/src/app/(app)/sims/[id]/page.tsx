'use client';

import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState, QueryState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, fullName } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { CHARGE_FIELDS, SimCardDialog, SimUsageDialog } from '@/features/sims/sim-dialogs';
import type { SimCard, SimUsage } from '@/lib/types';

/** "September 2026" for a billing month. */
const monthLabel = (period: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(period),
  );

export default function SimCardPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const query = useApi<SimCard>(`/sim-cards/${id}`, undefined, { placeholderData: undefined });
  const [editing, setEditing] = useState(false);
  const [usage, setUsage] = useState<SimUsage | 'new' | null>(null);
  const manage = can('sim.manage');

  const columns: Column<SimUsage>[] = [
    {
      key: 'period',
      header: 'Month',
      cell: (u) => <span className="whitespace-nowrap">{monthLabel(u.period)}</span>,
    },
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
                aria-label={`Edit ${monthLabel(u.period)}`}
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => setUsage(u)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <QueryState query={query}>
      {(sim) => (
        <>
          <BackLink href="/sims">SIM cards</BackLink>
          <PageHeader
            title={sim.phoneNumber}
            description={[sim.provider, sim.plan?.name].filter(Boolean).join(' · ') || 'No plan'}
            actions={
              manage && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<Pencil className="h-4 w-4" />}
                    onClick={() => setEditing(true)}
                  >
                    Edit SIM
                  </Button>
                  <Button icon={<Plus className="h-4 w-4" />} onClick={() => setUsage('new')}>
                    Record month
                  </Button>
                </div>
              )
            }
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader
                  title="Monthly usage"
                  description="Charges taken from the carrier bill, newest first."
                />
                <DataTable
                  caption={`Usage for ${sim.phoneNumber}`}
                  columns={columns}
                  rows={sim.usages}
                  empty={
                    <EmptyState
                      title="No months recorded"
                      description={manage ? 'Record a month from the carrier bill.' : undefined}
                    />
                  }
                />
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader title="Details" />
                <CardBody>
                  <DetailList
                    items={[
                      {
                        label: 'Status',
                        value: <StatusBadge group="simStatus" value={sim.status} />,
                      },
                      { label: 'Provider', value: sim.provider ?? '—' },
                      {
                        label: 'Rate plan',
                        value: sim.plan
                          ? `${sim.plan.name} · ${formatMoney(sim.plan.monthlyCharge, sim.plan.currency)}`
                          : '—',
                      },
                      {
                        label: 'SIM number',
                        value: sim.simNumber ? (
                          <span className="font-mono text-sm">{sim.simNumber}</span>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        label: 'Used by',
                        value: sim.employee ? (
                          <Link
                            href={`/employees/${sim.employee.id}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {fullName(sim.employee)}
                          </Link>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        label: 'In device',
                        value: sim.asset ? (
                          <Link
                            href={`/assets/${sim.asset.id}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {sim.asset.assetTag} — {sim.asset.name}
                          </Link>
                        ) : (
                          '—'
                        ),
                      },
                      { label: 'Activated', value: formatDate(sim.activatedAt) },
                      { label: 'Cancelled', value: formatDate(sim.cancelledAt) },
                      { label: 'Remarks', value: sim.remarks ?? '—' },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>

          <SimCardDialog open={editing} card={sim} onClose={() => setEditing(false)} />
          {usage && (
            <SimUsageDialog
              open
              simCardId={sim.id}
              usage={usage === 'new' ? null : usage}
              planCharge={sim.plan?.monthlyCharge}
              onClose={() => setUsage(null)}
            />
          )}
        </>
      )}
    </QueryState>
  );
}
