'use client';

import { PackagePlus, Pencil, Printer, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { EmployeePicker } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { AccessoryDialog } from '@/features/accessories/accessory-dialog';
import { AccessoryPieces } from '@/features/accessories/accessory-pieces';
import { api, downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, fullName, label } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { Accessory, AccessoryAssignment } from '@/lib/types';

type Tab = 'overview' | 'pieces' | 'handouts' | 'documents';

/** One number from the stock card. */
function Stat({ label: text, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
      <p className="text-xs text-slate-500">{text}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

export default function AccessoryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<Accessory>(`/accessories/${id}`, undefined, { placeholderData: undefined });
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pieces, setPieces] = useState<Set<string>>(new Set());
  const [returningId, setReturningId] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);
  const manage = can('accessory.manage');

  // Ticking pieces decides how many go out; otherwise it is a plain count.
  const count = pieces.size || quantity;

  const handOut = async () => {
    if (!employeeId) return toast.error(new Error('Choose an employee'));
    try {
      await api.post(`/accessories/${id}/assign`, {
        employeeId,
        quantity: count,
        unitIds: pieces.size ? [...pieces] : undefined,
      });
      toast.success(`${count} handed out`);
      setEmployeeId(null);
      setQuantity(1);
      setPieces(new Set());
      void query.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const togglePiece = (unitId: string) =>
    setPieces((chosen) => {
      const next = new Set(chosen);
      if (!next.delete(unitId)) next.add(unitId);
      return next;
    });

  const returnOne = async (assignmentId: string) => {
    try {
      await api.post(`/accessory-assignments/${assignmentId}/return`, {
        condition: damaged ? 'DAMAGED' : 'GOOD',
      });
      toast.success(damaged ? 'Returned damaged — written off' : 'Returned to stock');
      setReturningId(null);
      setDamaged(false);
      void query.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/accessories/${id}`);
      toast.success('Accessory removed');
      router.replace('/accessories');
    } catch (e) {
      toast.error(e);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <QueryState query={query}>
      {(a) => {
        const handedOut = a.quantityTotal - a.quantityAvailable;
        const low = a.quantityAvailable <= a.minStockLevel;
        const columns: Column<AccessoryAssignment>[] = [
          {
            key: 'employee',
            header: 'Employee',
            cell: (x) => (x.employee ? fullName(x.employee) : '—'),
          },
          { key: 'quantity', header: 'Qty', cell: (x) => x.quantity },
          { key: 'since', header: 'Given out', cell: (x) => formatDate(x.assignedAt) },
          {
            key: 'status',
            header: 'Status',
            cell: (x) =>
              x.status === 'ACTIVE' ? (
                <Badge tone="green">With them</Badge>
              ) : (
                <span className="text-sm text-slate-500">
                  Returned {x.returnedAt ? formatDate(x.returnedAt) : ''}
                </span>
              ),
          },
          ...(can('accessory.assign', 'asset.return')
            ? [
                {
                  key: 'actions',
                  header: '',
                  cell: (x: AccessoryAssignment) =>
                    x.status !== 'ACTIVE' ? null : returningId === x.id ? (
                      <span className="flex items-center justify-end gap-2">
                        <Checkbox
                          label="Damaged"
                          checked={damaged}
                          onChange={(e) => setDamaged(e.target.checked)}
                        />
                        <Button size="sm" onClick={() => returnOne(x.id)}>
                          Confirm
                        </Button>
                      </span>
                    ) : (
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Undo2 className="h-3.5 w-3.5" />}
                          onClick={() => setReturningId(x.id)}
                        >
                          Return
                        </Button>
                      </div>
                    ),
                },
              ]
            : []),
        ];

        return (
          <>
            <BackLink href="/accessories">Accessories</BackLink>
            <PageHeader
              title={a.name}
              description={`${a.code} · ${label('accessoryCategory', a.category)}${
                a.brand || a.model ? ` · ${[a.brand, a.model].filter(Boolean).join(' ')}` : ''
              }`}
              actions={
                manage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      icon={<Printer className="h-4 w-4" />}
                      onClick={() =>
                        downloadFile('/accessories/qr/labels', {
                          query: { ids: [a.id] },
                          fileName: `${a.code}-labels.pdf`,
                        }).catch((e) => toast.error(e))
                      }
                    >
                      Print labels
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Remove accessory"
                      icon={<Trash2 className="h-4 w-4 text-red-500" />}
                      onClick={() => setRemoving(true)}
                    />
                  </div>
                )
              }
            />

            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="In stock" value={String(a.quantityTotal)} />
              <Stat
                label="Available"
                value={String(a.quantityAvailable)}
                tone={low ? 'text-amber-600 dark:text-amber-400' : ''}
              />
              <Stat label="Handed out" value={String(handedOut)} />
              <Stat label="Minimum level" value={String(a.minStockLevel)} />
            </div>

            <div className="mb-6">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'overview', label: 'Overview' },
                  { value: 'pieces', label: 'Pieces', count: a._count?.units },
                  { value: 'handouts', label: 'Handed out', count: a._count?.assignments },
                  { value: 'documents', label: 'Documents' },
                ]}
              />
            </div>

            {tab === 'overview' && (
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-6 lg:col-span-2">
                  {can('accessory.assign') && a.quantityAvailable > 0 && (
                    <Card>
                      <CardHeader
                        title="Hand out"
                        description="Pick the pieces on the Pieces tab, or give out a number of them."
                      />
                      <CardBody>
                        <div className="grid gap-2 sm:grid-cols-[1fr_5rem_auto]">
                          <EmployeePicker value={employeeId} onChange={setEmployeeId} />
                          <Input
                            type="number"
                            min={1}
                            max={a.quantityAvailable}
                            value={count}
                            disabled={pieces.size > 0}
                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                            aria-label="Quantity"
                          />
                          <Button onClick={handOut} icon={<PackagePlus className="h-4 w-4" />}>
                            Hand out
                          </Button>
                        </div>
                        {pieces.size > 0 && (
                          <p className="mt-2 text-xs text-slate-500">
                            {pieces.size} piece{pieces.size > 1 ? 's' : ''} ticked on the Pieces
                            tab.
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  )}
                  <Card>
                    <CardHeader title="Details" />
                    <CardBody>
                      <DetailList
                        items={[
                          {
                            label: 'Stock code',
                            value: <span className="font-mono">{a.code}</span>,
                          },
                          { label: 'Category', value: label('accessoryCategory', a.category) },
                          { label: 'Brand', value: a.brand ?? '—' },
                          { label: 'Model', value: a.model ?? '—' },
                          { label: 'SKU', value: a.sku ?? '—' },
                          { label: 'Location', value: a.location?.name ?? '—' },
                          {
                            label: 'Purchase',
                            value: a.purchase ? (
                              <Link
                                href={`/purchases/${a.purchase.id}`}
                                className="text-blue-600 hover:underline dark:text-blue-400"
                              >
                                {a.purchase.orderNumber ?? 'Order'}
                              </Link>
                            ) : (
                              '—'
                            ),
                          },
                          { label: 'Unit cost', value: formatMoney(a.unitCost, a.currency) },
                          {
                            label: 'Stock value',
                            value: formatMoney(
                              Number(a.unitCost ?? 0) * a.quantityTotal,
                              a.currency,
                            ),
                          },
                          { label: 'Notes', value: a.notes ?? '—' },
                        ]}
                      />
                    </CardBody>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card>
                    <CardHeader title="Stock" />
                    <CardBody>
                      <DetailList
                        items={[
                          { label: 'Total', value: String(a.quantityTotal) },
                          {
                            label: 'Available',
                            value: (
                              <span className="inline-flex items-center gap-2">
                                {a.quantityAvailable}
                                {low && (
                                  <Badge tone={a.quantityAvailable === 0 ? 'red' : 'amber'}>
                                    {a.quantityAvailable === 0 ? 'Out of stock' : 'Low'}
                                  </Badge>
                                )}
                              </span>
                            ),
                          },
                          { label: 'Handed out', value: String(handedOut) },
                          { label: 'Minimum level', value: String(a.minStockLevel) },
                        ]}
                      />
                    </CardBody>
                  </Card>
                </div>
              </div>
            )}

            {tab === 'pieces' && (
              <AccessoryPieces
                accessory={a}
                selected={can('accessory.assign') ? pieces : undefined}
                onToggle={togglePiece}
              />
            )}

            {tab === 'handouts' && (
              <Card>
                <DataTable
                  caption={`Hand-outs of ${a.name}`}
                  columns={columns}
                  rows={a.assignments ?? []}
                  empty={<EmptyState title="Never handed out" />}
                />
              </Card>
            )}

            {tab === 'documents' && (
              <Card>
                <CardBody>
                  <Documents
                    documents={a.documents}
                    owner={{ accessoryId: a.id }}
                    invalidate={[`/accessories/${a.id}`]}
                    defaultType="INVOICE"
                  />
                </CardBody>
              </Card>
            )}

            <AccessoryDialog
              open={editing}
              accessory={a}
              onClose={() => {
                setEditing(false);
                void query.refetch();
              }}
            />
            <ConfirmDialog
              open={removing}
              onClose={() => setRemoving(false)}
              onConfirm={remove}
              title={`Remove ${a.name}?`}
              description="It is archived with its pieces, so past hand-overs stay in the records. Anything still handed out has to come back first."
              confirmLabel="Remove"
              danger
            />
          </>
        );
      }}
    </QueryState>
  );
}
