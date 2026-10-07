'use client';

import {
  AlertOctagon,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  ScanLine,
  Undo2,
  User,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { QrScanner } from '@/components/qr-scanner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AssetActionDialog } from '@/features/assets/asset-dialogs';
import { MaintenanceDialog } from '@/features/maintenance/maintenance-form';
import { api, ApiError } from '@/lib/api-client';
import { daysUntil, formatDate, fullName, label } from '@/lib/format';
import type { AccessoryScan, ScanHolder, ScanResult } from '@/lib/types';

/** One label-and-value pair in a scan card. */
function ScanField({
  label: name,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{name}</dt>
      <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  );
}

/** The person holding what was scanned: the name to ask for, and the number on their badge. */
function HolderHeading({ person }: { person: ScanHolder }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">Held by</p>
      <p className="text-xl font-semibold text-slate-900 dark:text-slate-50">{fullName(person)}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {[person.employeeNumber, person.jobTitle].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

/** Email and phone on one line, when the record has them. */
function ContactField({ person }: { person: ScanHolder }) {
  if (!person.email && !person.phone) return null;
  return (
    <ScanField label="Contact" wide>
      <span className="break-all">{[person.email, person.phone].filter(Boolean).join(' · ')}</span>
    </ScanField>
  );
}

/** A scanned accessory label: who has that piece, and how to reach them. */
function AccessoryResultCard({ scan, onClose }: { scan: AccessoryScan; onClose: () => void }) {
  const held = scan.unit?.assignment ?? null;
  const person = held?.employee ?? null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
              {scan.unit?.code ?? scan.accessory.code}
            </p>
            <Badge tone={person ? 'green' : 'teal'}>
              {person ? 'With an employee' : 'In the store'}
            </Badge>
          </div>
          <p className="truncate text-sm text-slate-600 dark:text-slate-400">
            {scan.accessory.name} · {label('accessoryCategory', scan.accessory.category)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close result"
          icon={<X className="h-4 w-4" />}
        />
      </div>
      <CardBody className="space-y-4">
        {person ? (
          <>
            <HolderHeading person={person} />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <ScanField label="Department">{person.department?.name ?? '—'}</ScanField>
              <ScanField label="Location">{person.location?.name ?? '—'}</ScanField>
              <ScanField label="Since">{formatDate(held!.assignedAt)}</ScanField>
              <ScanField label="Given with">
                {held!.assetAssignment ? held!.assetAssignment.asset.assetTag : 'On its own'}
              </ScanField>
              <ContactField person={person} />
            </dl>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/employees/${person.id}`} variant="secondary">
                Open employee
              </ButtonLink>
              <ButtonLink href={`/accessories/${scan.accessory.id}`} variant="secondary">
                Open accessory
              </ButtonLink>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Nobody is holding this piece — it is in the store.
            </p>
            <ButtonLink href={`/accessories/${scan.accessory.id}`} variant="secondary">
              Open accessory
            </ButtonLink>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ResultCard({
  result,
  code,
  onClose,
  onRescan,
}: {
  result: ScanResult;
  code: string;
  onClose: () => void;
  onRescan: () => void;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<'report_lost' | 'approve' | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [auditId, setAuditId] = useState(result.inProgressAudits[0]?.id ?? '');
  const [auditBusy, setAuditBusy] = useState(false);
  const a = result.asset;
  const held = result.currentAssignment;
  const person = held?.employee ?? null;
  const alongside = held?.accessoryAssignments ?? [];
  const actions = new Set(result.allowedActions);
  const warrantyDays = daysUntil(a.warrantyEndDate);

  const recordAudit = async () => {
    setAuditBusy(true);
    try {
      const { data } = await api.post<{ item: { result: string } }>(`/audits/${auditId}/scan`, {
        code,
      });
      toast.success(`Recorded in audit: ${label('auditResult', data.item.result)}`);
      onRescan();
    } catch (e) {
      toast.error(e);
    } finally {
      setAuditBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{a.assetTag}</p>
            <StatusBadge group="assetStatus" value={a.status} />
          </div>
          <p className="truncate text-sm text-slate-600 dark:text-slate-400">
            {a.name} · {a.assetType.name}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close result"
          icon={<X className="h-4 w-4" />}
        />
      </div>
      <CardBody className="space-y-4">
        {person && <HolderHeading person={person} />}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {person ? (
            <>
              <ScanField label="Department">{person.department?.name ?? '—'}</ScanField>
              <ScanField label="Since">{formatDate(held!.assignedAt)}</ScanField>
            </>
          ) : (
            <ScanField label="Holder">{held?.location?.name ?? 'Not assigned'}</ScanField>
          )}
          <ScanField label="Location">
            {person?.location?.name ?? a.location?.name ?? '—'}
          </ScanField>
          <ScanField label="Serial">
            <span className="font-mono text-xs">{a.serialNumber ?? '—'}</span>
          </ScanField>
          <ScanField label="Warranty">
            {a.warrantyEndDate ? (
              <span
                className={
                  warrantyDays! < 0
                    ? 'text-slate-500'
                    : warrantyDays! <= 30
                      ? 'text-amber-700 dark:text-amber-400'
                      : undefined
                }
              >
                {formatDate(a.warrantyEndDate)}
              </span>
            ) : (
              '—'
            )}
          </ScanField>
          {alongside.length > 0 && (
            <ScanField label="Issued with" wide>
              {alongside
                .map(
                  (x) =>
                    `${x.accessory.name}${
                      x.units.length
                        ? ` (${x.units.map((u) => u.code).join(', ')})`
                        : x.quantity > 1
                          ? ` ×${x.quantity}`
                          : ''
                    }`,
                )
                .join(' · ')}
            </ScanField>
          )}
          {person && <ContactField person={person} />}
        </dl>
        {result.openMaintenance && (
          <Badge tone="amber">Open maintenance MNT-{result.openMaintenance.number}</Badge>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ButtonLink
            href={`/assets/${a.id}`}
            variant="secondary"
            icon={<Eye className="h-4 w-4" />}
          >
            Details
          </ButtonLink>
          {person && (
            <ButtonLink
              href={`/employees/${person.id}`}
              variant="secondary"
              icon={<User className="h-4 w-4" />}
            >
              Employee
            </ButtonLink>
          )}
          {actions.has('assign') && (
            <ButtonLink href={`/assets/${a.id}/assign`} icon={<UserPlus className="h-4 w-4" />}>
              Assign
            </ButtonLink>
          )}
          {actions.has('return') && (
            <ButtonLink href={`/assets/${a.id}/return`} icon={<Undo2 className="h-4 w-4" />}>
              Return
            </ButtonLink>
          )}
          {actions.has('transfer') && (
            <ButtonLink
              href={`/assets/${a.id}/transfer`}
              variant="secondary"
              icon={<ArrowLeftRight className="h-4 w-4" />}
            >
              Transfer
            </ButtonLink>
          )}
          {actions.has('maintenance') && (
            <Button
              variant="secondary"
              onClick={() => setMaintenance(true)}
              icon={<Wrench className="h-4 w-4" />}
            >
              Maintenance
            </Button>
          )}
          {actions.has('approve') && (
            <Button
              onClick={() => setDialog('approve')}
              icon={<CheckCircle2 className="h-4 w-4" />}
            >
              Approve
            </Button>
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
        </div>

        {actions.has('audit') && result.inProgressAudits.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <ClipboardCheck className="h-4 w-4" /> Record in audit
            </p>
            <div className="flex gap-2">
              <Select
                value={auditId}
                onChange={(e) => setAuditId(e.target.value)}
                aria-label="Audit session"
              >
                {result.inProgressAudits.map((s) => (
                  <option key={s.id} value={s.id}>
                    AUD-{s.number} {s.name}
                  </option>
                ))}
              </Select>
              <Button onClick={recordAudit} loading={auditBusy}>
                Record
              </Button>
            </div>
          </div>
        )}
      </CardBody>
      <AssetActionDialog
        kind={dialog}
        onClose={() => setDialog(null)}
        asset={a}
        assignmentId={held?.id}
      />
      <MaintenanceDialog open={maintenance} onClose={() => setMaintenance(false)} asset={a} />
    </Card>
  );
}

export default function ScanPage() {
  const initial = useSearchParams().get('code');
  const router = useRouter();
  const [code, setCode] = useState<string | null>(initial);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [accessory, setAccessory] = useState<AccessoryScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const lookup = useCallback(
    async (value: string) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      setError(null);
      setCode(value);
      setAccessory(null);
      try {
        const { data } = await api.post<ScanResult>('/qr/scan', { code: value });
        setResult(data);
      } catch (e) {
        setResult(null);
        // Accessories carry labels of their own; a code that is not an asset may be one.
        if (e instanceof ApiError && e.code === 'NOT_FOUND') {
          try {
            // A scanned accessory label answers with whoever is holding that piece.
            const { data } = await api.post<AccessoryScan>('/accessories/scan', { code: value });
            setAccessory(data);
            return;
          } catch {
            // Not an accessory either; fall through to the message below.
          }
        }
        setError(
          e instanceof ApiError && e.code === 'NOT_FOUND'
            ? 'No asset or accessory matches this code, or it is outside your access.'
            : e instanceof Error
              ? e.message
              : 'Lookup failed',
        );
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (initial) {
      void lookup(initial);
      router.replace('/scan', { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Scan asset"
        description="Point the camera at an asset label, or type the tag or serial number."
      />
      <div className="space-y-4">
        {!result && !accessory && <QrScanner onDetect={lookup} paused={loading} />}
        {loading && <Spinner label="Looking up asset" />}
        {error && (
          <Card className="border-red-200 dark:border-red-900">
            <CardBody className="flex items-start gap-3 text-sm">
              <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">Not found</p>
                <p className="text-slate-600 dark:text-slate-400">{error}</p>
                {code && <p className="mt-1 break-all font-mono text-xs text-slate-500">{code}</p>}
              </div>
            </CardBody>
          </Card>
        )}
        {accessory && (
          <>
            <AccessoryResultCard scan={accessory} onClose={() => setAccessory(null)} />
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setAccessory(null)}
              icon={<ScanLine className="h-4 w-4" />}
            >
              Scan another
            </Button>
          </>
        )}
        {result && code && (
          <>
            <ResultCard
              result={result}
              code={code}
              onClose={() => setResult(null)}
              onRescan={() => setResult(null)}
            />
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setResult(null)}
              icon={<ScanLine className="h-4 w-4" />}
            >
              Scan another
            </Button>
          </>
        )}
        <p className="text-center text-xs text-slate-500">
          Tip: printed labels open this page directly when scanned with a phone camera.{' '}
          <Link href="/assets" className="text-blue-600 hover:underline">
            Browse assets
          </Link>
        </p>
      </div>
    </div>
  );
}
