'use client';

import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { EmployeeDialog } from '@/features/employees/employee-dialog';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, label, ticketRef } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

interface EmployeeAssets {
  active: {
    id: string;
    assignedAt: string;
    acknowledgedAt: string | null;
    expectedReturnAt: string | null;
    asset: {
      id: string;
      assetTag: string;
      name: string;
      serialNumber: string | null;
      status: string;
      assetType: { name: string };
    };
  }[];
  history: {
    id: string;
    status: string;
    assignedAt: string;
    returnedAt: string | null;
    asset: { id: string; assetTag: string; name: string };
  }[];
  accessories: {
    id: string;
    quantity: number;
    assignedAt: string;
    accessory: { id: string; name: string };
  }[];
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const query = useApi<Employee>(`/employees/${id}`, undefined, { placeholderData: undefined });
  const assets = useApi<EmployeeAssets>(`/employees/${id}/assets`);
  const tickets = useApi<
    {
      id: string;
      number: number;
      title: string;
      status: string;
      priority: string;
      createdAt: string;
    }[]
  >(`/employees/${id}/tickets`);

  return (
    <QueryState query={query}>
      {(e) => (
        <>
          <PageHeader
            back={
              can('employee.view', 'employee.view_department') ? (
                <BackLink href="/employees">Employees</BackLink>
              ) : undefined
            }
            title={
              <span className="flex flex-wrap items-center gap-3">
                {e.firstName} {e.lastName}
                <StatusBadge group="employeeStatus" value={e.status} />
              </span>
            }
            description={[e.jobTitle, e.department?.name].filter(Boolean).join(' · ')}
            actions={
              <>
                {can('employee.edit') && (
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(true)}
                    icon={<Pencil className="h-4 w-4" />}
                  >
                    Edit
                  </Button>
                )}
                {can('employee.delete') && (
                  <Button
                    variant="ghost"
                    onClick={() => setDeleting(true)}
                    icon={<Trash2 className="h-4 w-4" />}
                  >
                    Delete
                  </Button>
                )}
              </>
            }
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader
                  title="Assigned assets"
                  description={`${e._count.assignments} currently assigned`}
                />
                <QueryState query={assets}>
                  {(a) =>
                    a.active.length ? (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {a.active.map((row) => (
                          <li key={row.id}>
                            <Link
                              href={`/assets/${row.asset.id}`}
                              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            >
                              <span className="min-w-0">
                                <span className="font-medium text-slate-900 dark:text-slate-100">
                                  {row.asset.assetTag}
                                </span>{' '}
                                — {row.asset.name}
                                <span className="block text-xs text-slate-500">
                                  {row.asset.assetType.name} · since {formatDate(row.assignedAt)}
                                  {row.expectedReturnAt &&
                                    ` · due ${formatDate(row.expectedReturnAt)}`}
                                  {!row.acknowledgedAt && ' · not yet acknowledged'}
                                </span>
                              </span>
                              <StatusBadge group="assetStatus" value={row.asset.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title="No assets assigned" />
                    )
                  }
                </QueryState>
              </Card>
              {!!assets.data?.data.accessories.length && (
                <Card>
                  <CardHeader title="Accessories" />
                  <ul className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
                    {assets.data.data.accessories.map((acc) => (
                      <li key={acc.id} className="py-2.5 text-sm">
                        {acc.accessory.name}
                        {acc.quantity > 1 && ` × ${acc.quantity}`}{' '}
                        <span className="text-xs text-slate-500">
                          · since {formatDate(acc.assignedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card>
                <CardHeader title="Assignment history" />
                {assets.data?.data.history.length ? (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {assets.data.data.history.map((h) => (
                      <li
                        key={h.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm"
                      >
                        <Link
                          href={`/assets/${h.asset.id}`}
                          className="text-slate-900 hover:text-blue-600 dark:text-slate-100"
                        >
                          {h.asset.assetTag} — {h.asset.name}
                        </Link>
                        <span className="text-xs text-slate-500">
                          {formatDate(h.assignedAt)} → {formatDate(h.returnedAt)} ·{' '}
                          {label('assignmentStatus', h.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">
                    No previous assignments
                  </p>
                )}
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader title="Profile" />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      {
                        label: 'Employee number',
                        value: <span className="font-mono">{e.employeeNumber}</span>,
                      },
                      {
                        label: 'Email',
                        value: (
                          <a
                            href={`mailto:${e.email}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {e.email}
                          </a>
                        ),
                      },
                      { label: 'Phone', value: e.phone ?? '—' },
                      { label: 'Nationality', value: e.nationality ?? '—' },
                      { label: 'Location', value: e.location?.name ?? '—' },
                      {
                        label: 'Manager',
                        value: e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—',
                      },
                      { label: 'Hired', value: formatDate(e.hireDate) },
                      ...(e.terminationDate
                        ? [{ label: 'Left', value: formatDate(e.terminationDate) }]
                        : []),
                      {
                        label: 'User account',
                        value: e.user
                          ? `${e.user.status.toLowerCase()}${e.user.lastLoginAt ? ` · last sign-in ${formatDateTime(e.user.lastLoginAt)}` : ''}`
                          : 'None',
                      },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Tickets" />
                {tickets.data?.data.length ? (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {tickets.data.data.slice(0, 10).map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/tickets/${t.id}`}
                          className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        >
                          <span className="min-w-0 truncate">
                            <span className="text-slate-500">{ticketRef(t.number)}</span> {t.title}
                          </span>
                          <StatusBadge group="ticketStatus" value={t.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">No tickets</p>
                )}
              </Card>
            </div>
          </div>
          <EmployeeDialog open={editing} onClose={() => setEditing(false)} employee={e} />
          <ConfirmDialog
            open={deleting}
            onClose={() => setDeleting(false)}
            danger
            title="Delete employee?"
            description="The record is archived and kept for history. Employees who still hold assets, or have an active user account, cannot be deleted."
            confirmLabel="Delete"
            onConfirm={async () => {
              try {
                await api.delete(`/employees/${id}`);
                toast.success('Employee deleted');
                router.replace('/employees');
              } catch (err) {
                toast.error(err);
                setDeleting(false);
              }
            }}
          />
        </>
      )}
    </QueryState>
  );
}
