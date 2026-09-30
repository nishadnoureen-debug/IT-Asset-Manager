'use client';

import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { EnumSelect } from '@/components/pickers';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney, fullName, label, rentalRef } from '@/lib/format';
import { useApi, useListParams } from '@/lib/hooks';
import {
  CampDialog,
  EndRentalDialog,
  RentalDialog,
  RentalItemDialog,
} from '@/features/rentals/rental-dialogs';
import type { Camp, Rental, RentalItem } from '@/lib/types';

type Tab = 'rentals' | 'items' | 'camps';

const DEFAULTS = {
  tab: 'rentals',
  search: '',
  camp: '',
  type: '',
  status: '',
  page: '1',
};

/** "1 h 30 m" between two instants, or how long it has been out. */
function duration(startAt: string, endAt: string | null): string {
  const minutes = Math.round(
    (new Date(endAt ?? Date.now()).getTime() - new Date(startAt).getTime()) / 60_000,
  );
  if (minutes < 60) return `${Math.max(minutes, 0)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return `${Math.floor(hours / 24)} days`;
}

export default function RentalsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { params, set } = useListParams(DEFAULTS);
  const tab = (params.tab as Tab) || 'rentals';
  const manage = can('rental.manage');

  const [editingCamp, setEditingCamp] = useState<Camp | 'new' | null>(null);
  const [editingItem, setEditingItem] = useState<RentalItem | 'new' | null>(null);
  const [editingRental, setEditingRental] = useState<Rental | 'new' | null>(null);
  /** The item the new rental starts from, when it was started from the items tab. */
  const [rentingItemId, setRentingItemId] = useState<string | null>(null);
  const [ending, setEnding] = useState<Rental | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: 'camp' | 'item' | 'rental';
    id: string;
    name: string;
  } | null>(null);

  const camps = useApi<Camp[]>('/camps', { limit: 100 });
  const rentals = useApi<Rental[]>(tab === 'rentals' ? '/rentals' : null, {
    search: params.search,
    campId: params.camp || undefined,
    type: params.type || undefined,
    status: params.status || undefined,
    page: params.page,
    limit: 25,
  });
  const items = useApi<RentalItem[]>(tab === 'items' ? '/rental-items' : null, {
    search: params.search,
    campId: params.camp || undefined,
    type: params.type || undefined,
    page: params.page,
    limit: 50,
  });

  const remove = async () => {
    if (!deleting) return;
    const endpoint = { camp: 'camps', item: 'rental-items', rental: 'rentals' }[deleting.kind];
    try {
      await api.delete(`/${endpoint}/${deleting.id}`);
      toast.success(`${deleting.name} removed`);
      void camps.refetch();
      void items.refetch();
      void rentals.refetch();
    } catch (e) {
      toast.error(e);
    } finally {
      setDeleting(null);
    }
  };

  const rentalColumns: Column<Rental>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-slate-100">{r.item?.name}</p>
          <p className="truncate text-xs text-slate-500">
            {rentalRef(r.number)} · {r.item ? label('rentalItemType', r.item.type) : ''}
            {r.item?.code ? ` · ${r.item.code}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'camp', header: 'Camp', cell: (r) => r.item?.camp.name ?? '—' },
    {
      key: 'employee',
      header: 'Rented to',
      cell: (r) => (r.employee ? fullName(r.employee) : '—'),
    },
    {
      key: 'period',
      header: 'From',
      cell: (r) => (
        <div className="min-w-0 whitespace-nowrap">
          <p>{formatDateTime(r.startAt)}</p>
          <p className="text-xs text-slate-500">
            {r.endAt
              ? `${formatDateTime(r.endAt)} · ${duration(r.startAt, r.endAt)}`
              : `out ${duration(r.startAt, null)}`}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: 'charge',
      header: 'Charge',
      sort: 'charge',
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">{formatMoney(r.charge, r.currency)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge group="rentalStatus" value={r.status} />,
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (r: Rental) => (
              <div className="flex justify-end gap-1">
                {r.status === 'ACTIVE' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Take back ${rentalRef(r.number)}`}
                    icon={<RotateCcw className="h-4 w-4" />}
                    onClick={() => setEnding(r)}
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${rentalRef(r.number)}`}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => setEditingRental(r)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${rentalRef(r.number)}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() =>
                    setDeleting({ kind: 'rental', id: r.id, name: rentalRef(r.number) })
                  }
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const itemColumns: Column<RentalItem>[] = [
    {
      key: 'name',
      header: 'Item',
      cell: (i) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-slate-100">{i.name}</p>
          <p className="truncate text-xs text-slate-500">
            {label('rentalItemType', i.type)}
            {i.code ? ` · ${i.code}` : ''}
            {i.provider ? ` · ${i.provider}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'camp', header: 'Camp', cell: (i) => i.camp?.name ?? '—' },
    {
      key: 'charge',
      header: 'Usual charge',
      cell: (i) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatMoney(i.standardCharge, i.currency)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) => <StatusBadge group="rentalItemStatus" value={i.status} />,
    },
    {
      key: 'with',
      header: 'With',
      cell: (i) => {
        const out = i.rentals?.[0];
        return out?.employee ? fullName(out.employee) : '—';
      },
      hideOnMobile: true,
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (i: RentalItem) => (
              <div className="flex justify-end gap-1">
                {i.status === 'AVAILABLE' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Rent out ${i.name}`}
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      setRentingItemId(i.id);
                      setEditingRental('new');
                    }}
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${i.name}`}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => setEditingItem(i)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${i.name}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setDeleting({ kind: 'item', id: i.id, name: i.name })}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const campColumns: Column<Camp>[] = [
    {
      key: 'name',
      header: 'Camp',
      cell: (c) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-slate-100">{c.name}</p>
          <p className="truncate text-xs text-slate-500">
            {[c.code, c.location].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    { key: 'items', header: 'Items', cell: (c) => c._count?.items ?? 0 },
    { key: 'remarks', header: 'Remarks', cell: (c) => c.remarks ?? '—', hideOnMobile: true },
    ...(manage
      ? [
          {
            key: 'actions',
            header: '',
            cell: (c: Camp) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${c.name}`}
                  icon={<Pencil className="h-4 w-4" />}
                  onClick={() => setEditingCamp(c)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${c.name}`}
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setDeleting({ kind: 'camp', id: c.id, name: c.name })}
                />
              </div>
            ),
          },
        ]
      : []),
  ];

  const campFilter = (
    <Select
      aria-label="Camp"
      value={params.camp}
      onChange={(e) => set({ camp: e.target.value, page: '1' })}
    >
      <option value="">Every camp</option>
      {camps.data?.data.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );

  const newLabel = { rentals: 'Record a rental', items: 'New item', camps: 'New camp' }[tab];

  return (
    <>
      <PageHeader
        title="Camp rentals"
        description="WiFi cards and washing machines each camp rents to its employees."
        actions={
          manage && (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                tab === 'camps'
                  ? setEditingCamp('new')
                  : tab === 'items'
                    ? setEditingItem('new')
                    : (setRentingItemId(null), setEditingRental('new'))
              }
            >
              {newLabel}
            </Button>
          )
        }
      />
      <div className="mb-6">
        <Tabs<Tab>
          value={tab}
          onChange={(value) => set({ tab: value, page: '1', search: '' })}
          tabs={[
            { value: 'rentals', label: 'Rentals' },
            { value: 'items', label: 'Cards & machines' },
            { value: 'camps', label: 'Camps' },
          ]}
        />
      </div>

      {tab === 'rentals' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Item, card number or employee…"
            showReset={!!(params.search || params.camp || params.type || params.status)}
            onReset={() => set({ search: '', camp: '', type: '', status: '' })}
          >
            {campFilter}
            <EnumSelect
              group="rentalItemType"
              placeholder="Anything"
              value={params.type}
              onChange={(e) => set({ type: e.target.value, page: '1' })}
              aria-label="Type"
            />
            <EnumSelect
              group="rentalStatus"
              placeholder="Any status"
              value={params.status}
              onChange={(e) => set({ status: e.target.value, page: '1' })}
              aria-label="Status"
            />
          </FilterBar>
          <DataTable
            caption="Camp rentals"
            columns={rentalColumns}
            rows={rentals.data?.data}
            loading={rentals.isFetching}
            error={rentals.error}
            onRetry={() => void rentals.refetch()}
            meta={rentals.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={
              <EmptyState
                title="Nothing rented out"
                description={
                  manage ? 'Record a WiFi card or a washing time for an employee.' : undefined
                }
              />
            }
          />
        </Card>
      )}

      {tab === 'items' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Name, number or network…"
            showReset={!!(params.search || params.camp || params.type)}
            onReset={() => set({ search: '', camp: '', type: '' })}
          >
            {campFilter}
            <EnumSelect
              group="rentalItemType"
              placeholder="Anything"
              value={params.type}
              onChange={(e) => set({ type: e.target.value, page: '1' })}
              aria-label="Type"
            />
          </FilterBar>
          <DataTable
            caption="Cards and machines"
            columns={itemColumns}
            rows={items.data?.data}
            loading={items.isFetching}
            error={items.error}
            onRetry={() => void items.refetch()}
            meta={items.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={
              <EmptyState
                title="No items yet"
                description={manage ? 'Add the camp’s WiFi cards and washing machines.' : undefined}
              />
            }
          />
        </Card>
      )}

      {tab === 'camps' && (
        <Card>
          <FilterBar
            search={params.search}
            onSearch={(search) => set({ search })}
            placeholder="Camp name or code…"
            showReset={!!params.search}
            onReset={() => set({ search: '' })}
          />
          <DataTable
            caption="Camps"
            columns={campColumns}
            rows={camps.data?.data}
            loading={camps.isFetching}
            error={camps.error}
            onRetry={() => void camps.refetch()}
            empty={
              <EmptyState
                title="No camps yet"
                description={manage ? 'Add a camp before its cards and machines.' : undefined}
              />
            }
          />
        </Card>
      )}

      <CampDialog
        open={editingCamp !== null}
        camp={editingCamp === 'new' ? null : editingCamp}
        onClose={() => setEditingCamp(null)}
      />
      <RentalItemDialog
        open={editingItem !== null}
        item={editingItem === 'new' ? null : editingItem}
        campId={params.camp || undefined}
        onClose={() => setEditingItem(null)}
      />
      <RentalDialog
        open={editingRental !== null}
        rental={editingRental === 'new' ? null : editingRental}
        itemId={rentingItemId ?? undefined}
        campId={params.camp || undefined}
        onClose={() => {
          setEditingRental(null);
          setRentingItemId(null);
        }}
      />
      {ending && <EndRentalDialog open rental={ending} onClose={() => setEnding(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={`Remove ${deleting?.name ?? ''}?`}
        description={
          deleting?.kind === 'rental'
            ? 'The record goes for good and the item is free again.'
            : 'It is archived, so past rentals stay in the records.'
        }
        confirmLabel="Remove"
        danger
      />
    </>
  );
}
