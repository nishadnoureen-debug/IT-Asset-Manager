'use client';

import { CheckCircle2, Minus, PackageCheck, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { AssetPicker, EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, fullName, label, requestRef } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { Accessory, AssetRequest } from '@/lib/types';

type ActionKind = 'approve' | 'reject' | 'fulfil' | 'cancel';

const DIALOGS: Record<
  ActionKind,
  { title: string; description: string; label: string; notesLabel: string; required: boolean }
> = {
  approve: {
    title: 'Approve this request',
    description: 'IT can then issue the asset and record the handover.',
    label: 'Approve',
    notesLabel: 'Note for the requester (optional)',
    required: false,
  },
  reject: {
    title: 'Reject this request',
    description: 'The requester is told why.',
    label: 'Reject',
    notesLabel: 'Reason',
    required: true,
  },
  fulfil: {
    title: 'Record the handover',
    description:
      'Pick a free asset and any accessories. The asset is assigned to the employee and the handover form is generated.',
    label: 'Hand over',
    notesLabel: 'Note (optional)',
    required: false,
  },
  cancel: {
    title: 'Cancel this request',
    description: 'It will no longer wait for approval.',
    label: 'Cancel request',
    notesLabel: 'Reason (optional)',
    required: false,
  },
};

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAuth();
  const toast = useToast();
  const query = useApi<AssetRequest>(`/requests/${id}`, undefined, { placeholderData: undefined });
  const inv = ['/requests'];
  const approve = useApiMutation<Record<string, unknown>>('post', `/requests/${id}/approve`, inv);
  const reject = useApiMutation<Record<string, unknown>>('post', `/requests/${id}/reject`, inv);
  const fulfil = useApiMutation<Record<string, unknown>>('post', `/requests/${id}/fulfil`, inv);
  const cancel = useApiMutation<Record<string, unknown>>('post', `/requests/${id}/cancel`, inv);
  const regenerate = useApiMutation('post', `/requests/${id}/form`, inv);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [notes, setNotes] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [condition, setCondition] = useState('GOOD');
  const [lines, setLines] = useState<{ accessoryId: string; quantity: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Stock is only needed while handing over.
  const accessories = useApi<Accessory[]>(action === 'fulfil' ? '/accessories' : null, {
    limit: 100,
  });
  const inStock = (accessories.data?.data ?? []).filter(
    (a) => a.quantityAvailable > 0 && !lines.some((l) => l.accessoryId === a.id),
  );

  const pending = approve.isPending || reject.isPending || fulfil.isPending || cancel.isPending;

  const open = (kind: ActionKind) => {
    setAction(kind);
    setNotes('');
    setAssetId(null);
    setCondition('GOOD');
    setLines([]);
    setError(null);
  };

  const submit = async () => {
    if (!action) return;
    if (DIALOGS[action].required && notes.trim().length < 3) {
      setError('Please give a reason');
      return;
    }
    if (action === 'fulfil' && lines.length && !assetId) {
      setError('Choose the asset being handed over');
      return;
    }
    const body = {
      notes: notes.trim() || undefined,
      ...(action === 'fulfil'
        ? {
            assetId: assetId ?? undefined,
            condition,
            accessories: lines.length ? lines : undefined,
          }
        : {}),
    };
    const run = { approve, reject, fulfil, cancel }[action];
    try {
      await run.mutateAsync(body);
      toast.success(
        {
          approve: 'Request approved',
          reject: 'Request rejected',
          fulfil: 'Handover recorded',
          cancel: 'Request cancelled',
        }[action],
      );
      setAction(null);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <QueryState query={query}>
      {(r) => {
        const mine = r.createdBy?.id === user?.id || r.employee?.id === user?.employeeId;
        const canCancel =
          (r.status === 'SUBMITTED' || r.status === 'APPROVED') && (mine || can('request.cancel'));
        return (
          <>
            <BackLink href="/requests">Asset requests</BackLink>
            <PageHeader
              title={r.title}
              description={`${requestRef(r.number)} · ${label('requestType', r.type)}${
                r.quantity > 1 ? ` · ×${r.quantity}` : ''
              }`}
              actions={
                <div className="flex flex-wrap gap-2">
                  {r.status === 'SUBMITTED' && can('request.approve') && (
                    <>
                      <Button
                        icon={<CheckCircle2 className="h-4 w-4" />}
                        onClick={() => open('approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<XCircle className="h-4 w-4" />}
                        onClick={() => open('reject')}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && can('request.fulfil') && (
                    <Button
                      icon={<PackageCheck className="h-4 w-4" />}
                      onClick={() => open('fulfil')}
                    >
                      Record handover
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="secondary" onClick={() => open('cancel')}>
                      Cancel
                    </Button>
                  )}
                </div>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader title="Justification" />
                  <CardBody>
                    <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                      {r.justification}
                    </p>
                  </CardBody>
                </Card>
                {(r.decisionAt || r.cancelledAt) && (
                  <Card>
                    <CardHeader title="Decision" />
                    <CardBody>
                      <DetailList
                        items={[
                          {
                            label: 'Outcome',
                            value: <StatusBadge group="requestStatus" value={r.status} />,
                          },
                          { label: 'By', value: r.decisionBy?.displayName ?? '—' },
                          {
                            label: 'When',
                            value: r.decisionAt ? formatDateTime(r.decisionAt) : '—',
                          },
                          { label: 'Notes', value: r.decisionNotes || '—' },
                          ...(r.status === 'FULFILLED'
                            ? [
                                {
                                  label: 'Asset issued',
                                  value: r.asset ? (
                                    <Link
                                      href={`/assets/${r.asset.id}`}
                                      className="text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                      {r.asset.assetTag} — {r.asset.name}
                                    </Link>
                                  ) : (
                                    '—'
                                  ),
                                },
                                { label: 'Issued by', value: r.fulfilledBy?.displayName ?? '—' },
                              ]
                            : []),
                        ]}
                      />
                    </CardBody>
                  </Card>
                )}
                <Card>
                  <CardHeader
                    title="Form and attachments"
                    description="The request form is generated for printing and physical signatures."
                    actions={
                      can('request.edit') && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<RefreshCw className="h-4 w-4" />}
                          loading={regenerate.isPending}
                          onClick={async () => {
                            try {
                              await regenerate.mutateAsync({});
                              toast.success('Form regenerated');
                            } catch (e) {
                              toast.error(e);
                            }
                          }}
                        >
                          Regenerate form
                        </Button>
                      )
                    }
                  />
                  <CardBody>
                    <Documents
                      documents={r.documents}
                      owner={{ assetRequestId: r.id }}
                      invalidate={[`/requests/${r.id}`]}
                      defaultType="OTHER"
                    />
                  </CardBody>
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
                          value: <StatusBadge group="requestStatus" value={r.status} />,
                        },
                        {
                          label: 'Priority',
                          value: <StatusBadge group="priority" value={r.priority} />,
                        },
                        { label: 'Item', value: r.assetType?.name ?? '—' },
                        { label: 'Quantity', value: String(r.quantity) },
                        {
                          label: 'Required by',
                          value: r.neededBy ? formatDate(r.neededBy) : '—',
                        },
                        {
                          label: 'For',
                          value: r.employee ? (
                            <Link
                              href={`/employees/${r.employee.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {fullName(r.employee)}
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                        { label: 'Department', value: r.employee?.department?.name ?? '—' },
                        { label: 'Raised by', value: r.createdBy?.displayName ?? '—' },
                        { label: 'Raised on', value: formatDateTime(r.createdAt) },
                      ]}
                    />
                  </CardBody>
                </Card>
              </div>
            </div>

            <Dialog
              open={action !== null}
              onClose={() => setAction(null)}
              title={action ? DIALOGS[action].title : ''}
              description={action ? DIALOGS[action].description : ''}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setAction(null)}>
                    Close
                  </Button>
                  <Button
                    onClick={submit}
                    loading={pending}
                    variant={action === 'reject' ? 'danger' : 'primary'}
                  >
                    {action ? DIALOGS[action].label : ''}
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                {action === 'fulfil' && (
                  <>
                    <Field
                      label="Asset to hand over"
                      hint={
                        r.assetType
                          ? `Free ${r.assetType.name.toLowerCase()}s (in stock or available)`
                          : 'Assets that are in stock or available'
                      }
                    >
                      {(p) => (
                        <AssetPicker
                          id={p.id}
                          value={assetId}
                          onChange={setAssetId}
                          query={{
                            status: 'IN_STOCK,AVAILABLE',
                            assetTypeId: r.assetType?.id,
                          }}
                          placeholder="Search free assets by tag, name or serial…"
                        />
                      )}
                    </Field>
                    <Field label="Condition at handover">
                      {(p) => (
                        <EnumSelect
                          {...p}
                          group="assetCondition"
                          value={condition}
                          onChange={(e) => setCondition(e.target.value)}
                        />
                      )}
                    </Field>
                    <div>
                      <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Accessories from stock
                      </p>
                      <div className="space-y-2">
                        {lines.map((line) => {
                          const acc = accessories.data?.data.find((a) => a.id === line.accessoryId);
                          return (
                            <div key={line.accessoryId} className="flex items-center gap-2">
                              <span className="flex-1 truncate text-sm">
                                {acc?.name}
                                {acc && (
                                  <span className="text-slate-500">
                                    {' '}
                                    ({acc.quantityAvailable} in stock)
                                  </span>
                                )}
                              </span>
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label="Decrease"
                                icon={<Minus className="h-3 w-3" />}
                                disabled={line.quantity <= 1}
                                onClick={() =>
                                  setLines((ls) =>
                                    ls.map((l) =>
                                      l === line ? { ...l, quantity: l.quantity - 1 } : l,
                                    ),
                                  )
                                }
                              />
                              <span className="w-6 text-center text-sm tabular-nums">
                                {line.quantity}
                              </span>
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-label="Increase"
                                icon={<Plus className="h-3 w-3" />}
                                disabled={!!acc && line.quantity >= acc.quantityAvailable}
                                onClick={() =>
                                  setLines((ls) =>
                                    ls.map((l) =>
                                      l === line ? { ...l, quantity: l.quantity + 1 } : l,
                                    ),
                                  )
                                }
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Remove"
                                icon={<Trash2 className="h-4 w-4" />}
                                onClick={() => setLines((ls) => ls.filter((l) => l !== line))}
                              />
                            </div>
                          );
                        })}
                        <Select
                          aria-label="Add accessory"
                          value=""
                          onChange={(e) =>
                            e.target.value &&
                            setLines((ls) => [...ls, { accessoryId: e.target.value, quantity: 1 }])
                          }
                        >
                          <option value="">
                            {inStock.length ? '+ Add accessory…' : 'No accessories in stock'}
                          </option>
                          {inStock.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.quantityAvailable} available)
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </>
                )}
                <Field
                  label={action ? DIALOGS[action].notesLabel : ''}
                  error={error ?? undefined}
                  required={action ? DIALOGS[action].required : false}
                >
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={3}
                      value={notes}
                      onChange={(e) => {
                        setNotes(e.target.value);
                        setError(null);
                      }}
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
