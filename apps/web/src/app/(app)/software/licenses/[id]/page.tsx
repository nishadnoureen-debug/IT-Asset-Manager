'use client';

import { Eye, EyeOff, Pencil, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { AssetPicker, EmployeePicker } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { LicenseDialog } from '@/features/software/license-dialog';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { daysUntil, formatDate, formatMoney, fullName, label } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { License } from '@/lib/types';

export default function LicenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<License>(`/licenses/${id}`, undefined, { placeholderData: undefined });
  const assign = useApiMutation<Record<string, unknown>>('post', `/licenses/${id}/assign`, [
    '/licenses',
    '/software',
    '/assets',
  ]);
  const [target, setTarget] = useState<'employee' | 'asset'>('employee');
  const [pick, setPick] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const reveal = async () => {
    if (key !== null) return setKey(null);
    try {
      const { data } = await api.get<License>(`/licenses/${id}`, { query: { reveal: true } });
      setKey(data.licenseKey ?? '(no key stored)');
    } catch (e) {
      toast.error(e);
    }
  };

  const allocate = async () => {
    if (!pick)
      return toast.error(new Error(`Choose ${target === 'employee' ? 'an employee' : 'an asset'}`));
    try {
      await assign.mutateAsync(target === 'employee' ? { employeeId: pick } : { assetId: pick });
      toast.success('Seat assigned');
      setPick(null);
      void query.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const release = async (assignmentId: string) => {
    try {
      await api.post(`/licenses/${id}/unassign`, { assignmentId });
      toast.success('Seat released');
      void query.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <QueryState query={query}>
      {(l) => {
        const active = (l.assignments ?? []).filter((a) => !a.unassignedAt);
        const days = daysUntil(l.expiryDate);
        const full = l.seats !== null && l.usedSeats >= l.seats && !l.allowOverAllocation;
        return (
          <>
            <PageHeader
              back={<BackLink href="/software?tab=licenses">Licences</BackLink>}
              title={l.name ?? l.software.name}
              description={`${[l.software.name, l.software.version].filter(Boolean).join(' ')} · ${label('licenseType', l.licenseType)}`}
              actions={
                can('license.manage') && (
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(true)}
                    icon={<Pencil className="h-4 w-4" />}
                  >
                    Edit
                  </Button>
                )
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader
                    title="Seats"
                    description={
                      l.seats === null
                        ? `${l.usedSeats} in use · unlimited`
                        : `${l.usedSeats} of ${l.seats} in use${l.allowOverAllocation ? ' · over-allocation allowed' : ''}`
                    }
                  />
                  <CardBody className="space-y-4">
                    {can('license.assign', 'license.manage') && (
                      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                        {full ? (
                          <p className="text-sm text-amber-700 dark:text-amber-400">
                            All seats are allocated. Release a seat or allow over-allocation to
                            assign more.
                          </p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                            <Select
                              value={target}
                              onChange={(e) => {
                                setTarget(e.target.value as 'employee' | 'asset');
                                setPick(null);
                              }}
                              aria-label="Assign to"
                            >
                              <option value="employee">Employee</option>
                              <option value="asset">Device</option>
                            </Select>
                            {target === 'employee' ? (
                              <EmployeePicker value={pick} onChange={setPick} />
                            ) : (
                              <AssetPicker value={pick} onChange={setPick} />
                            )}
                            <Button
                              onClick={allocate}
                              loading={assign.isPending}
                              icon={<UserPlus className="h-4 w-4" />}
                            >
                              Assign seat
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {active.length ? (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {active.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-2 py-2.5 text-sm"
                          >
                            <span>
                              {a.employee ? (
                                <Link
                                  href={`/employees/${a.employee.id}`}
                                  className="text-slate-900 hover:text-blue-600 dark:text-slate-100"
                                >
                                  {fullName(a.employee)}
                                </Link>
                              ) : a.asset ? (
                                <Link
                                  href={`/assets/${a.asset.id}`}
                                  className="text-slate-900 hover:text-blue-600 dark:text-slate-100"
                                >
                                  {a.asset.assetTag} — {a.asset.name}
                                </Link>
                              ) : (
                                '—'
                              )}
                              <span className="block text-xs text-slate-500">
                                since {formatDate(a.assignedAt)}
                                {a.assignedBy && ` · by ${a.assignedBy.displayName}`}
                              </span>
                            </span>
                            {can('license.assign', 'license.manage') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => release(a.id)}
                                icon={<X className="h-4 w-4" />}
                              >
                                Release
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title="No seats assigned" />
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader
                    title="Documents"
                    description="Certificates, invoices and agreements"
                  />
                  <CardBody>
                    <Documents
                      documents={l.documents}
                      owner={{ softwareLicenseId: l.id }}
                      invalidate={[`/licenses/${l.id}`]}
                      defaultType="LICENSE_CERTIFICATE"
                    />
                  </CardBody>
                </Card>
              </div>
              <Card>
                <CardHeader title="Details" />
                <CardBody>
                  <DetailList
                    columns={1}
                    items={[
                      {
                        label: 'Expires',
                        value: l.expiryDate ? (
                          <span className="inline-flex items-center gap-2">
                            {formatDate(l.expiryDate)}
                            {days !== null && days < 0 ? (
                              <Badge tone="red">Expired</Badge>
                            ) : days !== null && days <= 30 ? (
                              <Badge tone="amber">{days} days</Badge>
                            ) : null}
                          </span>
                        ) : (
                          'Never'
                        ),
                      },
                      { label: 'Start', value: formatDate(l.startDate) },
                      { label: 'Vendor', value: l.vendor?.name ?? '—' },
                      { label: 'Cost', value: formatMoney(l.cost, l.currency) },
                      {
                        label: 'Licence key',
                        value: (
                          <span className="inline-flex items-center gap-2">
                            <span className="font-mono">{key ?? l.licenseKeyMasked ?? '—'}</span>
                            {can('license.manage') && l.licenseKeyMasked && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={reveal}
                                aria-label={key ? 'Hide key' : 'Reveal key'}
                                icon={
                                  key ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />
                                }
                              />
                            )}
                          </span>
                        ),
                      },
                      { label: 'Notes', value: l.notes ?? '—' },
                    ]}
                  />
                  {can('license.manage') && (
                    <p className="mt-3 text-xs text-slate-500">
                      Revealing a key is recorded in the activity log.
                    </p>
                  )}
                </CardBody>
              </Card>
            </div>
            <LicenseDialog
              open={editing}
              onClose={() => {
                setEditing(false);
                void query.refetch();
              }}
              license={l}
            />
          </>
        );
      }}
    </QueryState>
  );
}
