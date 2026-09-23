'use client';

import {
  AlertTriangle,
  CalendarClock,
  ClipboardCheck,
  KeyRound,
  Laptop,
  PackageCheck,
  Plus,
  QrCode,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { ASSET_STATUSES, type AssetCategory, type AssetStatus } from '@itam/shared';
import { BarList } from '@/components/bar-list';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth';
import { daysUntil, formatDate, formatMoney, formatRelative, label } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { HistoryEntry } from '@/lib/types';

interface Dashboard {
  scope: 'all' | 'department' | 'own' | null;
  assets: {
    total: number;
    byStatus: Partial<Record<AssetStatus, number>>;
    byCategory: { category: AssetCategory; count: number }[];
  };
  warrantyAlerts: {
    alertDays?: number;
    expiringCount: number;
    expiredCount?: number;
    items: {
      id: string;
      assetTag: string;
      name: string;
      warrantyEndDate: string;
      warrantyProvider: { name: string } | null;
    }[];
  };
  licenseAlerts: {
    alertDays?: number;
    expiringCount: number;
    items: {
      id: string;
      name: string | null;
      expiryDate: string;
      seats: number | null;
      software: { name: string; version: string | null };
    }[];
    totalSeats?: number;
    usedSeats?: number;
  };
  recentActivity: HistoryEntry[];
  assignments: {
    active: number;
    assignedThisMonth: number;
    returnedThisMonth: number;
    overdue: number;
    unacknowledged: number;
  } | null;
  maintenance: {
    scheduled: number;
    inProgress: number;
    completedThisMonth: number;
    costThisMonth: number;
  } | null;
  requests: {
    awaitingApproval: number;
    approved: number;
    highPriority: number;
    mine: number;
  } | null;
  audits: { inProgress: number } | null;
  mine: {
    assets: {
      id: string;
      assignedAt: string;
      acknowledgedAt: string | null;
      expectedReturnAt: string | null;
      asset: {
        id: string;
        assetTag: string;
        name: string;
        status: AssetStatus;
        assetType: { name: string };
      };
    }[];
    accessories: { id: string; quantity: number; accessory: { id: string; name: string } }[];
    openRequests: number;
  } | null;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function MyAssets({ mine }: { mine: NonNullable<Dashboard['mine']> }) {
  const pending = mine.assets.filter((a) => !a.acknowledgedAt).length;
  return (
    <Card>
      <CardHeader
        title="My equipment"
        description={
          pending
            ? `${pending} item${pending > 1 ? 's' : ''} waiting for your acknowledgement`
            : 'Assets and accessories assigned to you'
        }
      />
      <CardBody className="p-0">
        {mine.assets.length === 0 && mine.accessories.length === 0 ? (
          <EmptyState
            title="Nothing assigned to you"
            description="Assets handed to you will appear here."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {mine.assets.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/assets/${a.asset.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Laptop className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {a.asset.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.asset.assetTag} · {a.asset.assetType.name} · since{' '}
                      {formatDate(a.assignedAt)}
                      {a.expectedReturnAt && ` · due back ${formatDate(a.expectedReturnAt)}`}
                    </p>
                  </div>
                  {a.acknowledgedAt ? (
                    <StatusBadge group="assetStatus" value={a.asset.status} />
                  ) : (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300">
                      Acknowledge
                    </span>
                  )}
                </Link>
              </li>
            ))}
            {mine.accessories.map((acc) => (
              <li key={acc.id} className="flex items-center gap-3 px-5 py-3">
                <PackageCheck className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
                <p className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                  {acc.accessory.name}
                  {acc.quantity > 1 && <span className="text-slate-500"> × {acc.quantity}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ActivityFeed({ items }: { items: HistoryEntry[] }) {
  if (!items.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((h) => (
        <li key={h.id} className="flex gap-3 px-5 py-3">
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
            aria-hidden
          />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-slate-900 dark:text-slate-100">
              <span className="font-medium">{label('historyAction', h.action)}</span>
              {h.asset && (
                <>
                  {' · '}
                  <Link
                    href={`/assets/${h.asset.id}`}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {h.asset.assetTag}
                  </Link>
                </>
              )}
            </p>
            {h.description && (
              <p className="truncate text-slate-500 dark:text-slate-400">{h.description}</p>
            )}
            <p className="text-xs text-slate-400">
              {formatRelative(h.createdAt)}
              {h.performedBy && ` · ${h.performedBy.displayName}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const query = useApi<Dashboard>('/dashboard', undefined, { refetchInterval: 120_000 });
  const firstName = user?.employee?.firstName ?? user?.displayName.split(' ')[0];

  return (
    <>
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description="Overview of IT assets and what needs attention."
        actions={
          <>
            {can('qr.scan') && (
              <ButtonLink href="/scan" variant="secondary" icon={<QrCode className="h-4 w-4" />}>
                Scan
              </ButtonLink>
            )}
            {can('asset.create') && (
              <ButtonLink href="/assets/new" icon={<Plus className="h-4 w-4" />}>
                Add asset
              </ButtonLink>
            )}
            {!can('asset.create') && can('request.create') && (
              <ButtonLink href="/requests?new=1" icon={<Plus className="h-4 w-4" />}>
                Request an asset
              </ButtonLink>
            )}
          </>
        }
      />
      <QueryState query={query} loading={<DashboardSkeleton />}>
        {(d) => {
          const staff = d.scope === 'all' || d.scope === 'department';
          const statusData = ASSET_STATUSES.filter((s) => (d.assets.byStatus[s] ?? 0) > 0).map(
            (s) => ({
              key: s,
              label: label('assetStatus', s),
              value: d.assets.byStatus[s] ?? 0,
              href: `/assets?status=${s}`,
            }),
          );
          const categoryData = d.assets.byCategory.map((c) => ({
            key: c.category,
            label: label('assetCategory', c.category),
            value: c.count,
            href: `/assets?category=${c.category}`,
          }));

          return (
            <div className="space-y-6">
              {d.mine && !staff && <MyAssets mine={d.mine} />}

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {staff && (
                  <StatCard
                    label="Total assets"
                    value={d.assets.total}
                    icon={<Laptop className="h-4 w-4" />}
                    href="/assets"
                    hint={`${d.assets.byStatus.IN_STOCK ?? 0} in stock · ${d.assets.byStatus.AVAILABLE ?? 0} available`}
                  />
                )}
                {d.assignments && staff && (
                  <StatCard
                    label="Assigned"
                    value={d.assignments.active}
                    icon={<PackageCheck className="h-4 w-4" />}
                    hint={`${d.assignments.assignedThisMonth} this month · ${d.assignments.returnedThisMonth} returned`}
                    href="/assets?status=ASSIGNED"
                  />
                )}
                {d.maintenance && (
                  <StatCard
                    label="In repair"
                    value={d.maintenance.inProgress}
                    tone={d.maintenance.inProgress ? 'warning' : 'default'}
                    icon={<Wrench className="h-4 w-4" />}
                    hint={`${d.maintenance.scheduled} scheduled · ${formatMoney(d.maintenance.costThisMonth)} this month`}
                    href="/maintenance?open=true"
                  />
                )}
                {d.requests && (
                  <StatCard
                    label="Requests to approve"
                    value={d.requests.awaitingApproval}
                    tone={d.requests.awaitingApproval ? 'warning' : 'default'}
                    icon={<ClipboardCheck className="h-4 w-4" />}
                    hint={
                      d.requests.highPriority
                        ? `${d.requests.highPriority} high priority`
                        : `${d.requests.approved} approved, waiting for handover`
                    }
                    href="/requests?status=SUBMITTED"
                  />
                )}
                {staff && (
                  <StatCard
                    label="Warranty expiring"
                    value={d.warrantyAlerts.expiringCount}
                    tone={d.warrantyAlerts.expiringCount ? 'warning' : 'default'}
                    icon={<CalendarClock className="h-4 w-4" />}
                    hint={`Next ${d.warrantyAlerts.alertDays ?? 30} days · ${d.warrantyAlerts.expiredCount ?? 0} expired`}
                    href="/warranty?state=expiring"
                  />
                )}
                {d.assignments && staff && (
                  <StatCard
                    label="Overdue returns"
                    value={d.assignments.overdue}
                    tone={d.assignments.overdue ? 'danger' : 'default'}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    hint={`${d.assignments.unacknowledged} awaiting acknowledgement`}
                  />
                )}
                {d.licenseAlerts.totalSeats !== undefined && (
                  <StatCard
                    label="Licence seats used"
                    value={`${d.licenseAlerts.usedSeats ?? 0} / ${d.licenseAlerts.totalSeats}`}
                    icon={<KeyRound className="h-4 w-4" />}
                    hint={`${d.licenseAlerts.expiringCount} expiring soon`}
                    href="/software"
                  />
                )}
                {d.audits && (
                  <StatCard
                    label="Audits in progress"
                    value={d.audits.inProgress}
                    icon={<PackageCheck className="h-4 w-4" />}
                    href="/audits"
                  />
                )}
              </div>

              {staff && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Assets by status" description={`${d.assets.total} assets`} />
                    <CardBody>
                      <BarList data={statusData} total={d.assets.total} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader
                      title="Assets by category"
                      description="Select a bar to view the assets"
                    />
                    <CardBody>
                      <BarList data={categoryData} total={d.assets.total} />
                    </CardBody>
                  </Card>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader title="Recent activity" />
                  <ActivityFeed items={d.recentActivity} />
                </Card>
                <div className="space-y-6">
                  {staff && (
                    <Card>
                      <CardHeader
                        title="Warranties ending soon"
                        actions={
                          <Link
                            href="/warranty?state=expiring"
                            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                          >
                            View all
                          </Link>
                        }
                      />
                      {d.warrantyAlerts.items.length ? (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {d.warrantyAlerts.items.map((w) => {
                            const days = daysUntil(w.warrantyEndDate);
                            return (
                              <li key={w.id}>
                                <Link
                                  href={`/assets/${w.id}`}
                                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                                      {w.assetTag}
                                    </span>
                                    <span className="block truncate text-xs text-slate-500">
                                      {w.name}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">
                                    {days === 0 ? 'today' : `${days} days`}
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="px-5 py-6 text-center text-sm text-slate-500">
                          No warranties ending soon
                        </p>
                      )}
                    </Card>
                  )}
                  {d.licenseAlerts.items.length > 0 && (
                    <Card>
                      <CardHeader
                        title="Licences expiring"
                        actions={
                          <Link
                            href="/software?tab=licenses"
                            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                          >
                            View all
                          </Link>
                        }
                      />
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {d.licenseAlerts.items.map((l) => (
                          <li key={l.id}>
                            <Link
                              href={`/software/licenses/${l.id}`}
                              className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            >
                              <span className="min-w-0 truncate font-medium text-slate-900 dark:text-slate-100">
                                {l.name ?? l.software.name}
                              </span>
                              <span className="shrink-0 text-xs text-slate-500">
                                {formatDate(l.expiryDate)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}
                  {d.mine && staff && <MyAssets mine={d.mine} />}
                </div>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
