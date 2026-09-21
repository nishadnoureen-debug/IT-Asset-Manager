'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { AssetPicker } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { EmptyState, QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { Purchase } from '@/lib/types';

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const query = useApi<
    Purchase & { vendor: { id: string; name: string; email: string | null; phone: string | null } }
  >(`/purchases/${id}`, undefined, { placeholderData: undefined });
  const link = useApiMutation<Record<string, unknown>>('patch', `/purchases/${id}`, [
    '/purchases',
    '/assets',
  ]);
  const [assetId, setAssetId] = useState<string | null>(null);

  return (
    <QueryState query={query}>
      {(p) => (
        <>
          <PageHeader
            back={<BackLink href="/purchases">Purchases</BackLink>}
            title={p.orderNumber ?? p.invoiceNumber ?? 'Purchase'}
            description={`${p.vendor.name} · ${formatDate(p.purchaseDate)}`}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader
                  title="Assets"
                  description={`${p.assets?.length ?? 0} linked to this purchase`}
                />
                <CardBody className="space-y-4">
                  {can('purchase.manage') && (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <AssetPicker
                          value={assetId}
                          onChange={setAssetId}
                          placeholder="Link an existing asset…"
                        />
                      </div>
                      <Button
                        disabled={!assetId}
                        loading={link.isPending}
                        onClick={async () => {
                          try {
                            await link.mutateAsync({ assetIds: [assetId] });
                            toast.success('Asset linked');
                            setAssetId(null);
                            void query.refetch();
                          } catch (e) {
                            toast.error(e);
                          }
                        }}
                      >
                        Link
                      </Button>
                    </div>
                  )}
                  {p.assets?.length ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {p.assets.map((a) => (
                        <li key={a.id}>
                          <Link
                            href={`/assets/${a.id}`}
                            className="flex items-center justify-between gap-2 py-2.5 text-sm hover:text-blue-600"
                          >
                            <span>
                              <span className="font-medium">{a.assetTag}</span> — {a.name}
                            </span>
                            <span className="flex items-center gap-3">
                              <span className="tabular-nums text-slate-500">
                                {formatMoney(a.purchaseCost, a.currency)}
                              </span>
                              <StatusBadge group="assetStatus" value={a.status} />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No assets linked" />
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Invoice & documents" />
                <CardBody>
                  <Documents
                    documents={p.documents}
                    owner={{ purchaseId: p.id }}
                    invalidate={[`/purchases/${p.id}`]}
                    defaultType="INVOICE"
                  />
                </CardBody>
              </Card>
            </div>
            <Card>
              <CardHeader title="Summary" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Vendor', value: p.vendor.name },
                    { label: 'Order number', value: p.orderNumber ?? '—' },
                    { label: 'Invoice number', value: p.invoiceNumber ?? '—' },
                    { label: 'Purchase date', value: formatDate(p.purchaseDate) },
                    { label: 'Invoice date', value: formatDate(p.invoiceDate) },
                    { label: 'Subtotal', value: formatMoney(p.subtotal, p.currency) },
                    { label: 'Tax', value: formatMoney(p.taxAmount, p.currency) },
                    {
                      label: 'Total',
                      value: (
                        <span className="font-semibold">
                          {formatMoney(p.totalAmount, p.currency)}
                        </span>
                      ),
                    },
                    { label: 'Recorded by', value: p.createdBy?.displayName ?? '—' },
                    { label: 'Notes', value: p.notes ?? '—' },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </QueryState>
  );
}
