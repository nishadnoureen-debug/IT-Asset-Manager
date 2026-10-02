'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { EnumSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { AccessoryDialog } from '@/features/accessories/accessory-dialog';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatMoney, label } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import type { Accessory } from '@/lib/types';

const DEFAULTS = {
  search: '',
  category: '',
  lowStock: '',
  sortBy: 'name',
  sortOrder: 'asc',
  page: '1',
};

export default function AccessoriesPage() {
  const { can } = useAuth();
  const { params, set } = useListParams(DEFAULTS);
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Accessory | null>(null);
  const query = useApi<Accessory[]>('/accessories', {
    ...params,
    lowStock: params.lowStock || undefined,
    limit: 25,
  });

  const columns: Column<Accessory>[] = [
    {
      key: 'name',
      header: 'Accessory',
      sort: 'name',
      cell: (a) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{a.name}</p>
          <p className="text-xs text-slate-500">
            {[a.code, a.brand, a.model, a.sku].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sort: 'category',
      cell: (a) => label('accessoryCategory', a.category),
      hideOnMobile: true,
    },
    {
      key: 'stock',
      header: 'Available',
      sort: 'quantityAvailable',
      cell: (a) => (
        <span className="inline-flex items-center gap-2 tabular-nums">
          {a.quantityAvailable} / {a.quantityTotal}
          {a.quantityAvailable <= a.minStockLevel && (
            <Badge tone={a.quantityAvailable === 0 ? 'red' : 'amber'}>
              {a.quantityAvailable === 0 ? 'Out of stock' : 'Low'}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      cell: (a) => a.location?.name ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'cost',
      header: 'Unit cost',
      cell: (a) => formatMoney(a.unitCost, a.currency),
      hideOnMobile: true,
    },
    ...(can('accessory.manage')
      ? [
          {
            key: 'actions',
            header: '',
            cell: (a: Accessory) => (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${a.name}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRemoving(a);
                  }}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const remove = async () => {
    if (!removing) return;
    try {
      await api.delete(`/accessories/${removing.id}`);
      toast.success(`${removing.name} removed`);
      void query.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Accessories"
        description="Chargers, mice, keyboards, bags, docks and headsets - tracked by quantity."
        actions={
          can('accessory.manage') && (
            <Button onClick={() => setCreating(true)} icon={<Plus className="h-4 w-4" />}>
              Add accessory
            </Button>
          )
        }
      />
      <Card>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder="Code, name, SKU, brand…"
          showReset={!!(params.search || params.category || params.lowStock)}
          onReset={() => set({ search: '', category: '', lowStock: '' })}
        >
          <EnumSelect
            group="accessoryCategory"
            placeholder="All categories"
            value={params.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Category"
          />
          <div className="flex items-center">
            <Checkbox
              label="Low stock only"
              checked={params.lowStock === 'true'}
              onChange={(e) => set({ lowStock: e.target.checked ? 'true' : '' })}
            />
          </div>
        </FilterBar>
        <DataTable
          caption="Accessories"
          columns={columns}
          rows={query.data?.data}
          loading={query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(a) => router.push(`/accessories/${a.id}`)}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(sortBy, sortOrder) => set({ sortBy, sortOrder })}
          meta={query.data?.meta}
          onPage={(page) => set({ page: String(page) })}
          empty={
            <EmptyState
              title="No accessories"
              description="Add chargers, mice, bags and other items to track stock."
            />
          }
        />
      </Card>
      <AccessoryDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title={`Remove ${removing?.name ?? ''}?`}
        description="It is archived with its pieces, so past hand-overs stay in the records. Anything still handed out has to come back first."
        confirmLabel="Remove"
        danger
      />
    </>
  );
}
