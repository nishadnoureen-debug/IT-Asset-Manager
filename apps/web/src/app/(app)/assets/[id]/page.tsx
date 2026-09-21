'use client';

import {
  AlertOctagon,
  Archive,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  Pencil,
  Printer,
  RefreshCw,
  Trash2,
  Undo2,
  UserPlus,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState, QueryState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AssetActionDialog } from '@/features/assets/asset-dialogs';
import { MaintenanceDialog } from '@/features/maintenance/maintenance-form';
import { api, downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import {
  daysUntil,
  formatDate,
  formatDateTime,
  formatMoney,
  fullName,
  label,
  maintenanceRef,
} from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type {
  AssetDetail,
  Assignment,
  DocumentItem,
  HistoryEntry,
  MaintenanceRecord,
} from '@/lib/types';

type Tab = 'overview' | 'assignments' | 'history' | 'maintenance' | 'documents' | 'software' | 'qr';

function WarrantyBadge({ end }: { end: string | null }) {
  if (!end) return <span className="text-slate-400">No warranty recorded</span>;
  const days = daysUntil(end)!;
  return (
    <span className="inline-flex items-center gap-2">
      {formatDate(end)}
      {days < 0 ? (
        <Badge tone="gray">Expired</Badge>
      ) : days <= 30 ? (
        <Badge tone="amber">{days} days left</Badge>
      ) : (
        <Badge tone="green">Active</Badge>
      )}
    </span>
  );
}

function Overview({ a }: { a: AssetDetail }) {
  const current = a.currentAssignment;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList
              items={[
                {
                  label: 'Type',
                  value: `${a.assetType.name} · ${label('assetCategory', a.assetType.category)}`,
                },
                {
                  label: 'Brand / model',
                  value: [a.brand, a.model].filter(Boolean).join(' ') || '—',
                },
                {
                  label: 'Serial number',
                  value: a.serialNumber ? <span className="font-mono">{a.serialNumber}</span> : '—',
                },
                { label: 'Service tag', value: a.serviceTag ?? '—' },
                { label: 'Location', value: a.location?.name ?? '—' },
                { label: 'Owning department', value: a.department?.name ?? '—' },
                {
                  label: 'Condition',
                  value: <StatusBadge group="assetCondition" value={a.condition} />,
                },
                {
                  label: 'Registered',
                  value: `${formatDate(a.createdAt)}${a.createdBy ? ` by ${a.createdBy.displayName}` : ''}`,
                },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Purchase & warranty" />
          <CardBody>
            <DetailList
              items={[
                { label: 'Vendor', value: a.vendor?.name ?? '—' },
                {
                  label: 'Purchase order',
                  value: a.purchase ? (
                    <Link
                      href={`/purchases/${a.purchase.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {a.purchase.orderNumber ?? a.purchase.invoiceNumber ?? 'View purchase'}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Purchase date', value: formatDate(a.purchaseDate) },
                { label: 'Cost', value: formatMoney(a.purchaseCost, a.currency) },
                { label: 'Warranty provider', value: a.warrantyProvider?.name ?? '—' },
                { label: 'Warranty ends', value: <WarrantyBadge end={a.warrantyEndDate} /> },
                { label: 'Warranty reference', value: a.warrantyReference ?? '—' },
                { label: 'Coverage', value: a.warrantyCoverage ?? '—' },
              ]}
            />
          </CardBody>
        </Card>
        {(a.notes || a.disposalReason) && (
          <Card>
            <CardHeader title="Notes" />
            <CardBody className="space-y-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {a.notes && <p>{a.notes}</p>}
              {a.disposalReason && (
                <p>
                  <strong>Disposal:</strong> {a.disposalMethod} — {a.disposalReason} (
                  {formatDate(a.disposedAt)})
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Current holder" />
          <CardBody>
            {current ? (
              <div className="space-y-3 text-sm">
                <div>
                  {current.employee ? (
                    <Link
                      href={`/employees/${current.employee.id}`}
                      className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
                    >
                      {fullName(current.employee)}
                    </Link>
                  ) : (
                    <span className="font-medium">{current.location?.name}</span>
                  )}
                  <p className="text-slate-500">
                    {[current.employee?.employeeNumber, current.employee?.department?.name]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Since', value: formatDateTime(current.assignedAt) },
                    {
                      label: 'Expected return',
                      value: current.expectedReturnAt
                        ? formatDate(current.expectedReturnAt)
                        : 'Not set',
                    },
                    {
                      label: 'Acknowledged',
                      value: current.acknowledgedAt ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />{' '}
                          {formatDateTime(current.acknowledgedAt)}
                        </span>
                      ) : current.employee ? (
                        <Badge tone="amber">Pending</Badge>
                      ) : (
                        '—'
                      ),
                    },
                    {
                      label: 'Accessories',
                      value: current.accessoryAssignments.length
                        ? current.accessoryAssignments
                            .map(
                              (acc) =>
                                `${acc.accessory.name}${acc.quantity > 1 ? ` × ${acc.quantity}` : ''}`,
                            )
                            .join(', ')
                        : 'None',
                    },
                  ]}
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not assigned</p>
            )}
          </CardBody>
        </Card>
        {a.openMaintenance && (
          <Card className="border-amber-200 dark:border-amber-900">
            <CardHeader title="Open maintenance" />
            <CardBody className="text-sm">
              <Link
                href={`/maintenance/${a.openMaintenance.id}`}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {maintenanceRef(a.openMaintenance.number)} — {a.openMaintenance.title}
              </Link>
              <p className="mt-1">
                <StatusBadge group="maintenanceStatus" value={a.openMaintenance.status} />
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function AssignmentsTab({ id }: { id: string }) {
  const query = useApi<(Assignment & { documents: DocumentItem[] })[]>(`/assets/${id}/assignments`);
  return (
    <Card>
      <QueryState query={query}>
        {(rows) =>
          rows.length ? (
            <ol className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {r.employee ? fullName(r.employee) : r.location?.name}
                      {r.employee && r.location && (
                        <span className="text-slate-500"> @ {r.location.name}</span>
                      )}
                    </p>
                    <StatusBadge group="assignmentStatus" value={r.status} />
                  </div>
                  <p className="text-slate-500">
                    {formatDateTime(r.assignedAt)} →{' '}
                    {r.returnedAt ? formatDateTime(r.returnedAt) : 'present'}
                    {r.assignedBy && ` · by ${r.assignedBy.displayName}`}
                  </p>
                  <p className="text-slate-500">
                    Out: {label('assetCondition', r.conditionAtAssignment)}
                    {r.conditionAtReturn &&
                      ` · Back: ${label('assetCondition', r.conditionAtReturn)}`}
                    {r.acknowledgedAt && ' · Acknowledged'}
                  </p>
                  {r.transferReason && (
                    <p className="text-slate-600 dark:text-slate-400">
                      Transfer reason: {r.transferReason}
                    </p>
                  )}
                  {r.returnNotes && (
                    <p className="text-slate-600 dark:text-slate-400">{r.returnNotes}</p>
                  )}
                  {r.documents.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.documents.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => void downloadFile(`/documents/${d.id}/download`)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <Download className="h-3 w-3" /> {label('documentType', d.type)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Never assigned" />
          )
        }
      </QueryState>
    </Card>
  );
}

function HistoryTab({ id }: { id: string }) {
  const query = useApi<HistoryEntry[]>(`/assets/${id}/history`);
  return (
    <Card>
      <QueryState query={query}>
        {(rows) => (
          <ol className="relative space-y-0 px-5 py-4">
            {rows.map((h, i) => (
              <li key={h.id} className="relative flex gap-4 pb-5">
                {i < rows.length - 1 && (
                  <span
                    className="absolute left-[5px] top-4 h-full w-px bg-slate-200 dark:bg-slate-700"
                    aria-hidden
                  />
                )}
                <span
                  className="relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500 ring-4 ring-white dark:ring-slate-900"
                  aria-hidden
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {label('historyAction', h.action)}
                    {h.fromStatus && h.toStatus && h.fromStatus !== h.toStatus && (
                      <span className="font-normal text-slate-500">
                        {' '}
                        · {label('assetStatus', h.fromStatus)} → {label('assetStatus', h.toStatus)}
                      </span>
                    )}
                  </p>
                  {h.description && (
                    <p className="text-slate-600 dark:text-slate-400">{h.description}</p>
                  )}
                  <p className="text-xs text-slate-400">
                    {formatDateTime(h.createdAt)}
                    {h.performedBy && ` · ${h.performedBy.displayName}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </Card>
  );
}

function MaintenanceTab({ id }: { id: string }) {
  const query = useApi<MaintenanceRecord[]>(`/assets/${id}/maintenance`);
  return (
    <Card>
      <QueryState query={query}>
        {(rows) =>
          rows.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/maintenance/${m.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {maintenanceRef(m.number)} — {m.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {label('maintenanceType', m.type)} · {formatDate(m.createdAt)}
                        {m.technician && ` · ${m.technician.displayName}`}
                        {m.totalCost !== null && ` · ${formatMoney(m.totalCost, m.currency)}`}
                      </span>
                    </span>
                    <StatusBadge group="maintenanceStatus" value={m.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No maintenance recorded" />
          )
        }
      </QueryState>
    </Card>
  );
}

function SoftwareTab({ id }: { id: string }) {
  const query = useApi<
    {
      id: string;
      assignedAt: string;
      license: {
        id: string;
        name: string | null;
        licenseType: string;
        expiryDate: string | null;
        software: { name: string; version: string | null };
      };
    }[]
  >(`/assets/${id}/software`);
  return (
    <Card>
      <QueryState query={query}>
        {(rows) =>
          rows.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {[s.license.software.name, s.license.software.version]
                        .filter(Boolean)
                        .join(' ')}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {label('licenseType', s.license.licenseType)} · installed{' '}
                      {formatDate(s.assignedAt)}
                      {s.license.expiryDate && ` · expires ${formatDate(s.license.expiryDate)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No licensed software recorded on this device" />
          )
        }
      </QueryState>
    </Card>
  );
}

function QrTab({ asset }: { asset: AssetDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<{ dataUrl: string; payload: string }>(`/assets/${asset.id}/qr`);
  const regenerate = useApiMutation('post', `/assets/${asset.id}/qr/regenerate`, [
    `/assets/${asset.id}`,
  ]);
  const [confirm, setConfirm] = useState(false);

  const download = (format: 'png' | 'svg') =>
    downloadFile(`/assets/${asset.id}/qr/download`, { query: { format } }).catch((e) =>
      toast.error(e),
    );

  return (
    <Card>
      <CardBody>
        {query.isLoading ? (
          <Spinner />
        ) : query.data ? (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={query.data.data.dataUrl}
              alt={`QR code for ${asset.assetTag}`}
              className="h-56 w-56 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700"
            />
            <div className="space-y-3 text-sm">
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {asset.assetTag}
              </p>
              <p className="text-slate-600 dark:text-slate-400">{asset.name}</p>
              <p className="break-all font-mono text-xs text-slate-500">
                {query.data.data.payload}
              </p>
              <p className="text-slate-500">
                Scanning this code with a phone opens the asset and the actions you are allowed to
                take.
              </p>
              {can('qr.generate') && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Printer className="h-4 w-4" />}
                    onClick={() =>
                      downloadFile('/qr/labels', {
                        query: { assetIds: [asset.id] },
                        fileName: `${asset.assetTag}-label.pdf`,
                      }).catch((e) => toast.error(e))
                    }
                  >
                    Printable label
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => download('png')}
                  >
                    PNG
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => download('svg')}
                  >
                    SVG
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<RefreshCw className="h-4 w-4" />}
                    onClick={() => setConfirm(true)}
                  >
                    Regenerate
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        loading={regenerate.isPending}
        title="Regenerate QR code?"
        description="Labels already printed for this asset will stop working. Use this if a label was copied or lost."
        confirmLabel="Regenerate"
        danger
        onConfirm={async () => {
          try {
            await regenerate.mutateAsync({});
            toast.success('New QR code generated — print a new label');
            setConfirm(false);
            void query.refetch();
          } catch (e) {
            toast.error(e);
          }
        }}
      />
    </Card>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const initialTab = (useSearchParams().get('tab') as Tab) ?? 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dialog, setDialog] = useState<'retire' | 'dispose' | 'report_lost' | 'acknowledge' | null>(
    null,
  );
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<AssetDetail>(`/assets/${id}`, undefined, { placeholderData: undefined });
  const docs = useApi<DocumentItem[]>(tab === 'documents' ? `/assets/${id}/documents` : null);

  return (
    <QueryState query={query}>
      {(a) => {
        const actions = new Set(a.allowedActions);
        return (
          <>
            <PageHeader
              back={<BackLink href="/assets">Assets</BackLink>}
              title={
                <span className="flex flex-wrap items-center gap-3">
                  {a.assetTag}
                  <StatusBadge group="assetStatus" value={a.status} />
                </span>
              }
              description={`${a.name}${a.brand || a.model ? ` · ${[a.brand, a.model].filter(Boolean).join(' ')}` : ''}`}
              actions={
                <>
                  {actions.has('acknowledge') && (
                    <Button
                      onClick={() => setDialog('acknowledge')}
                      icon={<CheckCircle2 className="h-4 w-4" />}
                    >
                      Acknowledge receipt
                    </Button>
                  )}
                  {actions.has('assign') && (
                    <ButtonLink
                      href={`/assets/${id}/assign`}
                      icon={<UserPlus className="h-4 w-4" />}
                    >
                      Assign
                    </ButtonLink>
                  )}
                  {actions.has('return') && (
                    <ButtonLink
                      href={`/assets/${id}/return`}
                      variant="secondary"
                      icon={<Undo2 className="h-4 w-4" />}
                    >
                      Return
                    </ButtonLink>
                  )}
                  {actions.has('transfer') && (
                    <ButtonLink
                      href={`/assets/${id}/transfer`}
                      variant="secondary"
                      icon={<ArrowLeftRight className="h-4 w-4" />}
                    >
                      Transfer
                    </ButtonLink>
                  )}
                  {actions.has('maintenance') && (
                    <Button
                      variant="secondary"
                      onClick={() => setMaintenanceOpen(true)}
                      icon={<Wrench className="h-4 w-4" />}
                    >
                      Maintenance
                    </Button>
                  )}
                  {actions.has('edit') && (
                    <ButtonLink
                      href={`/assets/${id}/edit`}
                      variant="secondary"
                      icon={<Pencil className="h-4 w-4" />}
                    >
                      Edit
                    </ButtonLink>
                  )}
                  {actions.has('report_lost') && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialog('report_lost')}
                      icon={<AlertOctagon className="h-4 w-4" />}
                    >
                      Report lost
                    </Button>
                  )}
                  {actions.has('retire') && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialog('retire')}
                      icon={<Archive className="h-4 w-4" />}
                    >
                      Retire
                    </Button>
                  )}
                  {actions.has('dispose') && (
                    <Button
                      variant="ghost"
                      onClick={() => setDialog('dispose')}
                      icon={<Trash2 className="h-4 w-4" />}
                    >
                      Dispose
                    </Button>
                  )}
                  {can('asset.delete') &&
                    !a.currentAssignment &&
                    !a.openMaintenance &&
                    a.status !== 'DISPOSED' && (
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDelete(true)}
                        aria-label="Archive record"
                        icon={<Trash2 className="h-4 w-4 text-red-500" />}
                      />
                    )}
                </>
              }
            />

            <div className="mb-6">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'overview', label: 'Overview' },
                  { value: 'assignments', label: 'Assignments', count: a._count.assignments },
                  { value: 'history', label: 'History' },
                  {
                    value: 'maintenance',
                    label: 'Maintenance',
                    count: a._count.maintenance,
                    hidden: !can('maintenance.view'),
                  },
                  { value: 'documents', label: 'Documents' },
                  { value: 'software', label: 'Software' },
                  { value: 'qr', label: 'QR code' },
                ]}
              />
            </div>

            {tab === 'overview' && <Overview a={a} />}
            {tab === 'assignments' && <AssignmentsTab id={id} />}
            {tab === 'history' && <HistoryTab id={id} />}
            {tab === 'maintenance' && <MaintenanceTab id={id} />}
            {tab === 'documents' && (
              <Card>
                <CardBody>
                  {docs.isLoading ? (
                    <Spinner />
                  ) : (
                    <Documents
                      documents={docs.data?.data}
                      owner={{ assetId: id }}
                      invalidate={[`/assets/${id}`]}
                      defaultType="PHOTO"
                    />
                  )}
                </CardBody>
              </Card>
            )}
            {tab === 'software' && <SoftwareTab id={id} />}
            {tab === 'qr' && <QrTab asset={a} />}

            <AssetActionDialog
              kind={dialog}
              onClose={() => setDialog(null)}
              asset={a}
              assignmentId={a.currentAssignment?.id}
            />
            <MaintenanceDialog
              open={maintenanceOpen}
              onClose={() => setMaintenanceOpen(false)}
              asset={a}
            />
            <ConfirmDialog
              open={confirmDelete}
              onClose={() => setConfirmDelete(false)}
              danger
              title={`Archive ${a.assetTag}?`}
              description="The record is hidden from lists but kept for history and audits. For devices that left the company, use Retire and Dispose instead."
              confirmLabel="Archive"
              onConfirm={async () => {
                try {
                  await api.delete(`/assets/${id}`);
                  toast.success(`${a.assetTag} archived`);
                  router.replace('/assets');
                } catch (e) {
                  toast.error(e);
                }
              }}
            />
          </>
        );
      }}
    </QueryState>
  );
}
