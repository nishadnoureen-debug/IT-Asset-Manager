'use client';

import { CheckCircle2, Play, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { EnumSelect, StaffSelect } from '@/components/pickers';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/form';
import { QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney, label, maintenanceRef, ticketRef } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { MaintenanceRecord } from '@/lib/types';

export default function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<MaintenanceRecord>(`/maintenance/${id}`, undefined, {
    placeholderData: undefined,
  });
  const invalidate = ['/maintenance', '/assets'];
  const start = useApiMutation('post', `/maintenance/${id}/start`, invalidate);
  const complete = useApiMutation<Record<string, unknown>>(
    'post',
    `/maintenance/${id}/complete`,
    invalidate,
  );
  const cancel = useApiMutation<Record<string, unknown>>(
    'post',
    `/maintenance/${id}/cancel`,
    invalidate,
  );
  const update = useApiMutation<Record<string, unknown>>('patch', `/maintenance/${id}`, invalidate);

  const [dialog, setDialog] = useState<'complete' | 'cancel' | null>(null);
  const [labor, setLabor] = useState('');
  const [parts, setParts] = useState('');
  const [notes, setNotes] = useState('');
  const [condition, setCondition] = useState('GOOD');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await fn();
      toast.success(message);
      setDialog(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed');
      if (!dialog) toast.error(e);
    }
  };

  return (
    <QueryState query={query}>
      {(m) => {
        const open = m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS';
        return (
          <>
            <PageHeader
              back={<BackLink href="/maintenance">Maintenance</BackLink>}
              title={
                <span className="flex flex-wrap items-center gap-3">
                  {m.title}
                  <StatusBadge group="maintenanceStatus" value={m.status} />
                </span>
              }
              description={`${maintenanceRef(m.number)} · ${label('maintenanceType', m.type)}`}
              actions={
                <>
                  {m.status === 'SCHEDULED' && can('maintenance.edit') && (
                    <Button
                      onClick={() =>
                        run(() => start.mutateAsync({}), 'Work started — asset is in repair')
                      }
                      loading={start.isPending}
                      icon={<Play className="h-4 w-4" />}
                    >
                      Start work
                    </Button>
                  )}
                  {m.status === 'IN_PROGRESS' && can('maintenance.complete') && (
                    <Button
                      onClick={() => {
                        setLabor(m.laborCost != null ? String(m.laborCost) : '');
                        setParts(m.partsCost != null ? String(m.partsCost) : '');
                        setDialog('complete');
                      }}
                      icon={<CheckCircle2 className="h-4 w-4" />}
                    >
                      Complete
                    </Button>
                  )}
                  {open && can('maintenance.edit') && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialog('cancel')}
                      icon={<XCircle className="h-4 w-4" />}
                    >
                      Cancel job
                    </Button>
                  )}
                </>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader title="Details" />
                  <CardBody>
                    <DetailList
                      items={[
                        {
                          label: 'Asset',
                          value: m.asset ? (
                            <Link
                              href={`/assets/${m.asset.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {m.asset.assetTag} — {m.asset.name}
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                        {
                          label: 'Priority',
                          value: <StatusBadge group="priority" value={m.priority} />,
                        },
                        { label: 'Vendor', value: m.vendor?.name ?? 'In-house' },
                        {
                          label: 'Warranty claim',
                          value: m.isWarrantyClaim ? <Badge tone="blue">Yes</Badge> : 'No',
                        },
                        { label: 'Reported by', value: m.reportedBy?.displayName ?? '—' },
                        {
                          label: 'Related ticket',
                          value: m.ticket ? (
                            <Link
                              href={`/tickets/${m.ticket.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {ticketRef(m.ticket.number)}
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                        { label: 'Scheduled', value: formatDateTime(m.scheduledAt) },
                        { label: 'Started', value: formatDateTime(m.startedAt) },
                        {
                          label: 'Completed',
                          value: formatDateTime(m.completedAt ?? m.cancelledAt),
                        },
                        {
                          label: 'Cost',
                          value:
                            m.totalCost != null
                              ? `${formatMoney(m.totalCost, m.currency)} (labour ${formatMoney(m.laborCost, m.currency)}, parts ${formatMoney(m.partsCost, m.currency)})`
                              : '—',
                        },
                      ]}
                    />
                    {m.description && (
                      <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                        {m.description}
                      </p>
                    )}
                    {m.resolutionNotes && (
                      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                        <p className="font-medium text-slate-900 dark:text-slate-100">Resolution</p>
                        <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                          {m.resolutionNotes}
                        </p>
                      </div>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader
                    title="Attachments"
                    description="Repair receipts, quotes and photos"
                  />
                  <CardBody>
                    <Documents
                      documents={m.documents}
                      owner={{ maintenanceId: m.id }}
                      invalidate={[`/maintenance/${m.id}`]}
                      defaultType="REPAIR_RECEIPT"
                    />
                  </CardBody>
                </Card>
              </div>
              {open && can('maintenance.edit') && (
                <Card>
                  <CardHeader title="Technician" />
                  <CardBody>
                    <StaffSelect
                      aria-label="Technician"
                      value={m.technicianId ?? ''}
                      onChange={(e) =>
                        run(
                          () => update.mutateAsync({ technicianId: e.target.value || undefined }),
                          'Technician updated',
                        )
                      }
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      The technician is notified when assigned.
                    </p>
                  </CardBody>
                </Card>
              )}
            </div>

            <Dialog
              open={dialog === 'complete'}
              onClose={() => setDialog(null)}
              title="Complete maintenance"
              description="The asset returns to Assigned (if it has a holder) or Available."
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </Button>
                  <Button
                    loading={complete.isPending}
                    disabled={notes.trim().length < 3}
                    onClick={() =>
                      run(
                        () =>
                          complete.mutateAsync({
                            resolutionNotes: notes,
                            laborCost: labor ? Number(labor) : undefined,
                            partsCost: parts ? Number(parts) : undefined,
                            condition,
                          }),
                        'Maintenance completed',
                      )
                    }
                  >
                    Complete
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <FormError message={error} />
                <Field label="What was done?" required>
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  )}
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Labour cost">
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min="0"
                        step="0.01"
                        value={labor}
                        onChange={(e) => setLabor(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Parts cost">
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        min="0"
                        step="0.01"
                        value={parts}
                        onChange={(e) => setParts(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Condition">
                    {(p) => (
                      <EnumSelect
                        {...p}
                        group="assetCondition"
                        value={condition}
                        onChange={(e) => setCondition(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={dialog === 'cancel'}
              onClose={() => setDialog(null)}
              title="Cancel maintenance"
              size="sm"
              footer={
                <>
                  <Button variant="secondary" onClick={() => setDialog(null)}>
                    Back
                  </Button>
                  <Button
                    variant="danger"
                    loading={cancel.isPending}
                    disabled={notes.trim().length < 3}
                    onClick={() =>
                      run(() => cancel.mutateAsync({ reason: notes }), 'Maintenance cancelled')
                    }
                  >
                    Cancel job
                  </Button>
                </>
              }
            >
              <div className="space-y-3">
                <FormError message={error} />
                <Field label="Reason" required>
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </Dialog>
          </>
        );
      }}
    </QueryState>
  );
}
