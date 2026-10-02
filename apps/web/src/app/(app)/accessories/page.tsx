'use client';

import { PackagePlus, Plus, Printer, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FilterBar } from '@/components/filter-bar';
import { EmployeePicker, EnumSelect, LocationSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { EmptyState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, downloadFile } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, fullName, label } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { Accessory, AccessoryUnit } from '@/lib/types';

const DEFAULTS = {
  search: '',
  category: '',
  lowStock: '',
  sortBy: 'name',
  sortOrder: 'asc',
  page: '1',
};

interface FormValues {
  name: string;
  category: string;
  sku: string;
  brand: string;
  model: string;
  quantityTotal: string;
  minStockLevel: string;
  locationId: string;
  unitCost: string;
  notes: string;
}

function AccessoryDialog({
  open,
  onClose,
  accessory,
}: {
  open: boolean;
  onClose: () => void;
  accessory?: Accessory;
}) {
  const toast = useToast();
  const editing = !!accessory;
  const mutation = useApiMutation<Record<string, unknown>>(
    editing ? 'patch' : 'post',
    editing ? `/accessories/${accessory.id}` : '/accessories',
    ['/accessories'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>();

  useEffect(() => {
    if (open)
      reset({
        name: accessory?.name ?? '',
        category: accessory?.category ?? 'CHARGER',
        sku: accessory?.sku ?? '',
        brand: accessory?.brand ?? '',
        model: accessory?.model ?? '',
        quantityTotal: String(accessory?.quantityTotal ?? 0),
        minStockLevel: String(accessory?.minStockLevel ?? 0),
        locationId: accessory?.locationId ?? '',
        unitCost: accessory?.unitCost != null ? String(accessory.unitCost) : '',
        notes: accessory?.notes ?? '',
      });
  }, [open, accessory, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== ''),
    );
    for (const k of ['quantityTotal', 'minStockLevel', 'unitCost'])
      if (body[k] !== undefined) body[k] = Number(body[k]);
    try {
      await mutation.mutateAsync(body);
      toast.success(editing ? 'Accessory updated' : 'Accessory added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors))
          setError(f as keyof FormValues, { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit accessory' : 'Add accessory'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Name" required error={errors.name?.message}>
            {(p) => <Input {...p} {...register('name', { required: 'Required' })} />}
          </Field>
          <Field label="Category" required>
            {(p) => <EnumSelect {...p} group="accessoryCategory" {...register('category')} />}
          </Field>
          <Field label="SKU" error={errors.sku?.message}>
            {(p) => <Input {...p} className="uppercase" {...register('sku')} />}
          </Field>
          <Field label="Location">
            {(p) => <LocationSelect {...p} placeholder="None" {...register('locationId')} />}
          </Field>
          <Field label="Brand">{(p) => <Input {...p} {...register('brand')} />}</Field>
          <Field label="Model">{(p) => <Input {...p} {...register('model')} />}</Field>
          <Field
            label="Total quantity"
            error={errors.quantityTotal?.message}
            hint={editing ? 'Available stock changes by the same amount' : undefined}
          >
            {(p) => <Input {...p} type="number" min="0" {...register('quantityTotal')} />}
          </Field>
          <Field label="Low-stock threshold" error={errors.minStockLevel?.message}>
            {(p) => <Input {...p} type="number" min="0" {...register('minStockLevel')} />}
          </Field>
          <Field label="Unit cost" error={errors.unitCost?.message}>
            {(p) => <Input {...p} type="number" min="0" step="0.01" {...register('unitCost')} />}
          </Field>
        </FormGrid>
        <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

/** Every piece of an accessory: its code, where it is, and the labels to print. */
function AccessoryPieces({
  accessory,
  selected,
  onToggle,
}: {
  accessory: Accessory;
  /** Pieces ticked for the next hand-out; undefined hides the tick boxes. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  const toast = useToast();
  const query = useApi<AccessoryUnit[]>(`/accessories/${accessory.id}/units`);
  const units = query.data?.data ?? [];

  const sheet = (ids?: string[]) =>
    downloadFile('/accessories/qr/labels', {
      query: ids ? { unitIds: ids } : { ids: [accessory.id] },
      fileName: `${accessory.code}-labels.pdf`,
    }).catch((e) => toast.error(e));

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <p className="text-sm font-medium">Pieces ({units.length})</p>
        <Button
          variant="secondary"
          size="sm"
          icon={<Printer className="h-4 w-4" />}
          onClick={() => sheet()}
        >
          Print all labels
        </Button>
      </div>
      {query.isLoading ? (
        <div className="p-3">
          <Spinner />
        </div>
      ) : units.length ? (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {units.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              {selected && u.status === 'IN_STOCK' && (
                <input
                  type="checkbox"
                  aria-label={`Hand out ${u.code}`}
                  checked={selected.has(u.id)}
                  onChange={() => onToggle?.(u.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
              )}
              <span className="font-mono">{u.code}</span>
              <Badge
                tone={u.status === 'IN_STOCK' ? 'teal' : u.status === 'ASSIGNED' ? 'green' : 'gray'}
              >
                {label('accessoryUnitStatus', u.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                {u.assignment?.employee ? fullName(u.assignment.employee) : ''}
                {u.assignment?.assetAssignment
                  ? ` · with ${u.assignment.assetAssignment.asset.assetTag}`
                  : ''}
                {u.serialNumber ? ` · S/N ${u.serialNumber}` : ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Label for ${u.code}`}
                icon={<Printer className="h-3.5 w-3.5" />}
                onClick={() => sheet([u.id])}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-3 text-sm text-slate-500">No pieces yet — add stock to label them.</p>
      )}
    </div>
  );
}

function AccessoryDetail({ accessory, onClose }: { accessory: Accessory; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const detail = useApi<Accessory>(`/accessories/${accessory.id}`, undefined, {
    placeholderData: undefined,
  });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pieces, setPieces] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  const assign = useApiMutation<Record<string, unknown>>(
    'post',
    `/accessories/${accessory.id}/assign`,
    ['/accessories', '/employees'],
  );
  const [returningId, setReturningId] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);

  const a = detail.data?.data ?? accessory;
  const active = (detail.data?.data.assignments ?? []).filter((x) => x.status === 'ACTIVE');

  // Ticking pieces decides how many go out; otherwise it is a plain count.
  const count = pieces.size || quantity;

  const handOut = async () => {
    if (!employeeId) return toast.error(new Error('Choose an employee'));
    try {
      await assign.mutateAsync({
        employeeId,
        quantity: count,
        unitIds: pieces.size ? [...pieces] : undefined,
      });
      toast.success(`${count} × ${a.name} handed out`);
      setEmployeeId(null);
      setQuantity(1);
      setPieces(new Set());
      void detail.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  const togglePiece = (id: string) =>
    setPieces((chosen) => {
      const next = new Set(chosen);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const returnOne = async (id: string) => {
    try {
      await api.post(`/accessory-assignments/${id}/return`, {
        condition: damaged ? 'DAMAGED' : 'GOOD',
      });
      toast.success(damaged ? 'Returned damaged — written off' : 'Returned to stock');
      setReturningId(null);
      setDamaged(false);
      void detail.refetch();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={a.name}
      description={`${label('accessoryCategory', a.category)} · ${a.quantityAvailable} of ${a.quantityTotal} available`}
      size="lg"
    >
      <div className="space-y-5">
        {can('accessory.assign') && a.quantityAvailable > 0 && (
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-sm font-medium">Hand out</p>
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
              <Button
                onClick={handOut}
                loading={assign.isPending}
                icon={<PackagePlus className="h-4 w-4" />}
              >
                Hand out
              </Button>
            </div>
          </div>
        )}
        <AccessoryPieces
          accessory={a}
          selected={can('accessory.assign') ? pieces : undefined}
          onToggle={togglePiece}
        />
        <div>
          <p className="mb-2 text-sm font-medium">Currently handed out ({active.length})</p>
          {detail.isLoading ? (
            <Spinner />
          ) : active.length ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {active.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span>
                    {x.employee ? fullName(x.employee) : '—'} {x.quantity > 1 && `× ${x.quantity}`}
                    <span className="block text-xs text-slate-500">
                      since {formatDate(x.assignedAt)}
                      {x.assetAssignment && ` · with ${x.assetAssignment.asset.assetTag}`}
                    </span>
                  </span>
                  {can('accessory.assign', 'asset.return') &&
                    (returningId === x.id ? (
                      <span className="flex items-center gap-2">
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
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Undo2 className="h-3.5 w-3.5" />}
                        onClick={() => setReturningId(x.id)}
                      >
                        Return
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">None</p>
          )}
        </div>
        {can('accessory.manage') && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit details & stock
          </Button>
        )}
      </div>
      <AccessoryDialog
        open={editing}
        onClose={() => {
          setEditing(false);
          void detail.refetch();
        }}
        accessory={a}
      />
    </Dialog>
  );
}

export default function AccessoriesPage() {
  const { can } = useAuth();
  const { params, set } = useListParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Accessory | null>(null);
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
  ];

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
          onRowClick={setOpen}
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
      {open && <AccessoryDetail accessory={open} onClose={() => setOpen(null)} />}
    </>
  );
}
