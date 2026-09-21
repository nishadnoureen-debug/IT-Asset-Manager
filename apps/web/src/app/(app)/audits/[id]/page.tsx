'use client';

import { CheckCheck, Download, Lock, Play, ScanLine, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { EnumSelect, LocationSelect } from '@/components/pickers';
import { QrScanner } from '@/components/qr-scanner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { EmptyState, QueryState, Spinner } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api, downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { auditRef, formatDateTime, label } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { AuditItem, AuditSession } from '@/lib/types';

type Filter = 'all' | 'PENDING' | 'FOUND' | 'issues';

function ScanMode({
  session,
  onClose,
  onScanned,
}: {
  session: AuditSession;
  onClose: () => void;
  onScanned: () => void;
}) {
  const toast = useToast();
  const [observedLocationId, setObservedLocationId] = useState(session.locationId ?? '');
  const [damaged, setDamaged] = useState(false);
  const [last, setLast] = useState<{ tag: string; result: string } | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const record = async (code: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post<{ item: AuditItem; recognized: boolean }>(
        `/audits/${session.id}/scan`,
        {
          code,
          observedLocationId: observedLocationId || undefined,
          condition: damaged ? 'DAMAGED' : undefined,
        },
      );
      setLast({
        tag: data.item.asset?.assetTag ?? data.item.scannedCode ?? code,
        result: data.item.result,
      });
      setCount((c) => c + 1);
      setDamaged(false);
      onScanned();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const tone =
    last?.result === 'FOUND'
      ? 'green'
      : last?.result === 'UNEXPECTED' || last?.result === 'WRONG_LOCATION'
        ? 'amber'
        : 'red';

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Scanning — ${session.name}`}
      description={`${count} scanned this session`}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Where are you?" hint="Used to flag assets in the wrong place">
            {(p) => (
              <LocationSelect
                {...p}
                placeholder="Not specified"
                value={observedLocationId}
                onChange={(e) => setObservedLocationId(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={damaged}
              onChange={(e) => setDamaged(e.target.checked)}
            />
            Next scan is damaged
          </label>
        </div>
        {last && (
          <div
            role="status"
            className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
          >
            <span className="font-medium">{last.tag}</span>
            <Badge tone={tone}>{label('auditResult', last.result)}</Badge>
          </div>
        )}
        <QrScanner onDetect={record} paused={busy} />
      </div>
    </Dialog>
  );
}

export default function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [scanning, setScanning] = useState(false);
  const [confirm, setConfirm] = useState<'start' | 'complete' | 'close' | 'cancel' | null>(null);
  const [reviewing, setReviewing] = useState<AuditItem | null>(null);
  const [resolution, setResolution] = useState('');
  const [newResult, setNewResult] = useState('');
  const [manualCode, setManualCode] = useState('');
  const session = useApi<AuditSession>(`/audits/${id}`, undefined, { placeholderData: undefined });
  const items = useApi<AuditItem[]>(`/audits/${id}/items`);
  const inv = ['/audits'];
  const start = useApiMutation('post', `/audits/${id}/start`, inv);
  const complete = useApiMutation('post', `/audits/${id}/complete`, inv);
  const closeAudit = useApiMutation('post', `/audits/${id}/close`, inv);
  const cancel = useApiMutation('post', `/audits/${id}/cancel`, inv);
  const review = useApiMutation<Record<string, unknown>>(
    'patch',
    () => `/audits/${id}/items/${reviewing?.id}`,
    inv,
  );

  const refresh = () => {
    void session.refetch();
    void items.refetch();
  };

  const runConfirm = async () => {
    const actions = { start, complete, close: closeAudit, cancel };
    const messages = {
      start: 'Audit started — start scanning',
      complete: 'Audit completed — unscanned assets marked missing',
      close: 'Audit closed',
      cancel: 'Audit cancelled',
    };
    try {
      await actions[confirm!].mutateAsync({});
      toast.success(messages[confirm!]);
      setConfirm(null);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <QueryState query={session}>
      {(s) => {
        const rows = (items.data?.data ?? []).filter((i) =>
          filter === 'all'
            ? true
            : filter === 'issues'
              ? ['MISSING', 'UNEXPECTED', 'WRONG_LOCATION', 'DAMAGED'].includes(i.result)
              : i.result === filter,
        );
        const issues =
          s.summary.MISSING + s.summary.UNEXPECTED + s.summary.WRONG_LOCATION + s.summary.DAMAGED;
        const canPerform = can('audit.perform');
        return (
          <>
            <PageHeader
              back={<BackLink href="/audits">Audits</BackLink>}
              title={
                <span className="flex flex-wrap items-center gap-3">
                  {s.name}
                  <StatusBadge group="auditStatus" value={s.status} />
                </span>
              }
              description={`${auditRef(s.number)} · ${[s.location?.name, s.department?.name].filter(Boolean).join(' · ') || 'All assets'}`}
              actions={
                <>
                  {s.status === 'DRAFT' && canPerform && (
                    <Button onClick={() => setConfirm('start')} icon={<Play className="h-4 w-4" />}>
                      Start audit
                    </Button>
                  )}
                  {s.status === 'IN_PROGRESS' && canPerform && (
                    <Button
                      onClick={() => setScanning(true)}
                      icon={<ScanLine className="h-4 w-4" />}
                    >
                      Scan
                    </Button>
                  )}
                  {s.status === 'IN_PROGRESS' && canPerform && (
                    <Button
                      variant="secondary"
                      onClick={() => setConfirm('complete')}
                      icon={<CheckCheck className="h-4 w-4" />}
                    >
                      Complete
                    </Button>
                  )}
                  {s.status === 'IN_REVIEW' && can('audit.review', 'audit.perform') && (
                    <Button onClick={() => setConfirm('close')} icon={<Lock className="h-4 w-4" />}>
                      Close audit
                    </Button>
                  )}
                  {s.summary.total > 0 && can('report.view', 'report.export') && (
                    <Button
                      variant="secondary"
                      icon={<Download className="h-4 w-4" />}
                      onClick={() =>
                        downloadFile('/reports/audit', {
                          query: { auditId: id, format: 'pdf' },
                        }).catch((e) => toast.error(e))
                      }
                    >
                      Report
                    </Button>
                  )}
                  {['DRAFT', 'IN_PROGRESS'].includes(s.status) && can('audit.create') && (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirm('cancel')}
                      icon={<X className="h-4 w-4" />}
                    >
                      Cancel
                    </Button>
                  )}
                </>
              }
            />

            {s.status === 'DRAFT' ? (
              <Card>
                <EmptyState
                  title="Not started yet"
                  description="Starting takes a snapshot of every asset expected in this scope. Then scan what you find on site."
                />
              </Card>
            ) : (
              <>
                <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard label="Expected" value={s.summary.total - s.summary.UNEXPECTED} />
                  <StatCard label="Found" value={s.summary.FOUND} tone="success" />
                  <StatCard
                    label={s.status === 'IN_PROGRESS' ? 'Not yet scanned' : 'Missing'}
                    value={s.status === 'IN_PROGRESS' ? s.summary.PENDING : s.summary.MISSING}
                    tone={s.summary.MISSING ? 'danger' : 'default'}
                  />
                  <StatCard
                    label="Other issues"
                    value={s.summary.UNEXPECTED + s.summary.WRONG_LOCATION + s.summary.DAMAGED}
                    tone={issues ? 'warning' : 'default'}
                    hint="Unexpected, wrong location, damaged"
                  />
                </div>
                {s.status === 'IN_PROGRESS' && canPerform && (
                  <Card className="mb-6">
                    <CardBody>
                      <form
                        className="flex gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!manualCode.trim()) return;
                          try {
                            const { data } = await api.post<{ item: AuditItem }>(
                              `/audits/${id}/scan`,
                              {
                                code: manualCode.trim(),
                                observedLocationId: s.locationId ?? undefined,
                              },
                            );
                            toast.success(
                              `${data.item.asset?.assetTag ?? manualCode}: ${label('auditResult', data.item.result)}`,
                            );
                            setManualCode('');
                            refresh();
                          } catch (err) {
                            toast.error(err);
                          }
                        }}
                      >
                        <Input
                          value={manualCode}
                          onChange={(e) => setManualCode(e.target.value)}
                          placeholder="Type or scan with a USB scanner: tag, serial or QR link"
                          aria-label="Asset code"
                        />
                        <Button type="submit" variant="secondary">
                          Record
                        </Button>
                      </form>
                    </CardBody>
                  </Card>
                )}
                <Card>
                  <div className="px-4 pt-3">
                    <Tabs<Filter>
                      value={filter}
                      onChange={setFilter}
                      tabs={[
                        { value: 'all', label: 'All', count: s.summary.total },
                        {
                          value: 'PENDING',
                          label: 'Not scanned',
                          count: s.summary.PENDING,
                          hidden: s.status !== 'IN_PROGRESS',
                        },
                        { value: 'FOUND', label: 'Found', count: s.summary.FOUND },
                        { value: 'issues', label: 'Discrepancies', count: issues },
                      ]}
                    />
                  </div>
                  {items.isLoading ? (
                    <Spinner />
                  ) : rows.length ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rows.map((i) => (
                        <li
                          key={i.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                        >
                          <div className="min-w-0">
                            {i.asset ? (
                              <Link
                                href={`/assets/${i.asset.id}`}
                                className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
                              >
                                {i.asset.assetTag} — {i.asset.name}
                              </Link>
                            ) : (
                              <span className="font-mono font-medium">{i.scannedCode}</span>
                            )}
                            <p className="text-xs text-slate-500">
                              {i.expectedLocation && `Expected: ${i.expectedLocation.name}`}
                              {i.observedLocation && ` · Seen: ${i.observedLocation.name}`}
                              {i.scannedAt &&
                                ` · ${formatDateTime(i.scannedAt)}${i.scannedBy ? ` by ${i.scannedBy.displayName}` : ''}`}
                            </p>
                            {i.resolution && (
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                Resolution: {i.resolution}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge group="auditResult" value={i.result} />
                            {s.status === 'IN_REVIEW' &&
                              can('audit.review', 'audit.perform') &&
                              i.result !== 'FOUND' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setReviewing(i);
                                    setResolution(i.resolution ?? '');
                                    setNewResult(i.result);
                                  }}
                                >
                                  {i.reviewedAt ? 'Edit review' : 'Review'}
                                </Button>
                              )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="Nothing in this view" />
                  )}
                </Card>
              </>
            )}

            {scanning && (
              <ScanMode session={s} onClose={() => setScanning(false)} onScanned={refresh} />
            )}
            <ConfirmDialog
              open={!!confirm}
              onClose={() => setConfirm(null)}
              onConfirm={runConfirm}
              loading={
                start.isPending || complete.isPending || closeAudit.isPending || cancel.isPending
              }
              danger={confirm === 'cancel'}
              title={
                {
                  start: 'Start this audit?',
                  complete: 'Complete scanning?',
                  close: 'Close this audit?',
                  cancel: 'Cancel this audit?',
                }[confirm ?? 'start']
              }
              description={
                {
                  start: 'The list of expected assets is fixed at this moment.',
                  complete: `${s.summary.PENDING} assets that were not scanned will be marked missing. You can review discrepancies afterwards.`,
                  close:
                    'The audit becomes read-only. Make sure every discrepancy has been reviewed.',
                  cancel: 'The audit is stopped and kept for reference.',
                }[confirm ?? 'start']
              }
              confirmLabel={
                {
                  start: 'Start',
                  complete: 'Complete',
                  close: 'Close audit',
                  cancel: 'Cancel audit',
                }[confirm ?? 'start']
              }
            />
            <Dialog
              open={!!reviewing}
              onClose={() => setReviewing(null)}
              title={`Review ${reviewing?.asset?.assetTag ?? reviewing?.scannedCode ?? ''}`}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setReviewing(null)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={resolution.trim().length < 2}
                    loading={review.isPending}
                    onClick={async () => {
                      try {
                        await review.mutateAsync({ resolution, result: newResult || undefined });
                        toast.success('Review saved');
                        setReviewing(null);
                        refresh();
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    Save review
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <Field label="Result">
                  {(p) => (
                    <EnumSelect
                      {...p}
                      group="auditResult"
                      exclude={['PENDING']}
                      value={newResult}
                      onChange={(e) => setNewResult(e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Resolution"
                  required
                  hint="e.g. Found in meeting room 2; moved location; reported lost"
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
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
