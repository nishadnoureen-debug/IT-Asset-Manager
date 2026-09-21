'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { LABELS } from '@itam/shared';
import { FilterBar } from '@/components/filter-bar';
import { VendorSelect } from '@/components/pickers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, label } from '@/lib/format';
import { useApi, useApiMutation, useListParams } from '@/lib/hooks';
import type { Purchase, Vendor } from '@/lib/types';

const DEFAULTS = { tab: 'purchases', search: '', vendorId: '', page: '1' };

function PurchaseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const mutation = useApiMutation<Record<string, unknown>, Purchase>('post', '/purchases', [
    '/purchases',
  ]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Record<string, string>>();
  useEffect(() => {
    if (open)
      reset({
        orderNumber: '',
        invoiceNumber: '',
        vendorId: '',
        purchaseDate: new Date().toISOString().slice(0, 10),
        subtotal: '',
        taxAmount: '',
        currency: '',
        notes: '',
      });
  }, [open, reset]);
  const onSubmit = handleSubmit(async (v) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== ''),
    );
    for (const k of ['subtotal', 'taxAmount']) if (body[k] !== undefined) body[k] = Number(body[k]);
    try {
      const { data } = await mutation.mutateAsync(body);
      toast.success('Purchase recorded');
      onClose();
      router.push(`/purchases/${data.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f, { message: m });
        setError('root', {
          message:
            e.code === 'CONFLICT'
              ? 'This order or invoice number already exists for the vendor.'
              : e.message,
        });
      }
    }
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Record purchase"
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
          <Field label="Vendor" required error={errors.vendorId?.message}>
            {(p) => (
              <VendorSelect {...p} {...register('vendorId', { required: 'Choose a vendor' })} />
            )}
          </Field>
          <Field label="Purchase date" required error={errors.purchaseDate?.message}>
            {(p) => (
              <Input {...p} type="date" {...register('purchaseDate', { required: 'Required' })} />
            )}
          </Field>
          <Field label="Order number">{(p) => <Input {...p} {...register('orderNumber')} />}</Field>
          <Field label="Invoice number">
            {(p) => <Input {...p} {...register('invoiceNumber')} />}
          </Field>
          <Field label="Subtotal">
            {(p) => <Input {...p} type="number" min="0" step="0.01" {...register('subtotal')} />}
          </Field>
          <Field label="Tax">
            {(p) => <Input {...p} type="number" min="0" step="0.01" {...register('taxAmount')} />}
          </Field>
          <Field label="Currency" hint="Defaults to the company currency">
            {(p) => <Input {...p} maxLength={3} className="uppercase" {...register('currency')} />}
          </Field>
        </FormGrid>
        <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
        <p className="text-xs text-slate-500">
          After saving, attach the invoice and link assets from the purchase page or the asset form.
        </p>
      </form>
    </Dialog>
  );
}

function VendorDialog({
  open,
  onClose,
  vendor,
}: {
  open: boolean;
  onClose: () => void;
  vendor?: Vendor;
}) {
  const toast = useToast();
  const editing = !!vendor;
  const mutation = useApiMutation<Record<string, unknown>>(
    editing ? 'patch' : 'post',
    editing ? `/vendors/${vendor.id}` : '/vendors',
    ['/vendors'],
  );
  const [types, setTypes] = useState<string[]>([]);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Record<string, string | boolean>>();
  useEffect(() => {
    if (!open) return;
    reset({
      name: vendor?.name ?? '',
      contactName: vendor?.contactName ?? '',
      email: vendor?.email ?? '',
      phone: vendor?.phone ?? '',
      website: vendor?.website ?? '',
      address: vendor?.address ?? '',
      taxNumber: vendor?.taxNumber ?? '',
      notes: vendor?.notes ?? '',
      isActive: vendor?.isActive ?? true,
    });
    setTypes(vendor?.types ?? []);
  }, [open, vendor, reset]);
  const onSubmit = handleSubmit(async (v) => {
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== ''),
    );
    body.types = types;
    try {
      await mutation.mutateAsync(body);
      toast.success(editing ? 'Vendor updated' : 'Vendor added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f, { message: m });
        setError('root', {
          message: e.code === 'CONFLICT' ? 'A vendor with this name already exists.' : e.message,
        });
      }
    }
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit vendor' : 'Add vendor'}
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
        <FormError message={errors.root?.message as string | undefined} />
        <FormGrid>
          <Field label="Name" required error={errors.name?.message as string | undefined}>
            {(p) => <Input {...p} {...register('name', { required: 'Required' })} />}
          </Field>
          <Field label="Contact person">
            {(p) => <Input {...p} {...register('contactName')} />}
          </Field>
          <Field label="Email" error={errors.email?.message as string | undefined}>
            {(p) => <Input {...p} type="email" {...register('email')} />}
          </Field>
          <Field label="Phone">{(p) => <Input {...p} {...register('phone')} />}</Field>
          <Field label="Website" error={errors.website?.message as string | undefined}>
            {(p) => <Input {...p} placeholder="https://" {...register('website')} />}
          </Field>
          <Field label="Tax number">{(p) => <Input {...p} {...register('taxNumber')} />}</Field>
        </FormGrid>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            Vendor type
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {Object.entries(LABELS.vendorType).map(([value, text]) => (
              <Checkbox
                key={value}
                label={text}
                checked={types.includes(value)}
                onChange={(e) =>
                  setTypes((t) => (e.target.checked ? [...t, value] : t.filter((x) => x !== value)))
                }
              />
            ))}
          </div>
        </fieldset>
        <Field label="Address">
          {(p) => <Textarea {...p} rows={2} {...register('address')} />}
        </Field>
        <Checkbox label="Active" {...register('isActive')} />
      </form>
    </Dialog>
  );
}

export default function PurchasesPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { params, set } = useListParams(DEFAULTS);
  const [dialog, setDialog] = useState<'purchase' | 'vendor' | null>(null);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const tab = can('purchase.view') ? params.tab : 'vendors';
  const purchases = useApi<Purchase[]>(tab === 'purchases' ? '/purchases' : null, {
    search: params.search,
    vendorId: params.vendorId,
    page: params.page,
    limit: 25,
  });
  const vendors = useApi<Vendor[]>(tab === 'vendors' ? '/vendors' : null, {
    search: params.search,
    page: params.page,
    limit: 25,
  });

  const purchaseColumns: Column<Purchase>[] = [
    {
      key: 'ref',
      header: 'Order / invoice',
      cell: (p) => (
        <div>
          <Link
            href={`/purchases/${p.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-slate-900 hover:text-blue-600 dark:text-slate-100"
          >
            {p.orderNumber ?? p.invoiceNumber ?? 'Purchase'}
          </Link>
          {p.invoiceNumber && p.orderNumber && (
            <p className="text-xs text-slate-500">Invoice {p.invoiceNumber}</p>
          )}
        </div>
      ),
    },
    { key: 'vendor', header: 'Vendor', cell: (p) => p.vendor.name },
    { key: 'date', header: 'Date', cell: (p) => formatDate(p.purchaseDate) },
    {
      key: 'total',
      header: 'Total',
      cell: (p) => <span className="tabular-nums">{formatMoney(p.totalAmount, p.currency)}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      cell: (p) => `${p._count?.assets ?? 0} assets`,
      hideOnMobile: true,
    },
    {
      key: 'docs',
      header: 'Documents',
      cell: (p) =>
        p._count?.documents ? p._count.documents : <Badge tone="amber">No invoice</Badge>,
      hideOnMobile: true,
    },
  ];

  const vendorColumns: Column<Vendor>[] = [
    {
      key: 'name',
      header: 'Vendor',
      cell: (v) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{v.name}</p>
          <p className="text-xs text-slate-500">
            {v.types.map((t) => label('vendorType', t)).join(', ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: (v) => (
        <div className="text-sm">
          {v.contactName ?? '—'}
          <p className="text-xs text-slate-500">{[v.email, v.phone].filter(Boolean).join(' · ')}</p>
        </div>
      ),
      hideOnMobile: true,
    },
    { key: 'counts', header: 'Purchases', cell: (v) => v._count?.purchases ?? 0 },
    { key: 'assets', header: 'Assets', cell: (v) => v._count?.assets ?? 0, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (v) => (v.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        title="Purchases & vendors"
        description="Invoices, costs and suppliers linked to your assets."
        actions={
          <>
            {can('vendor.manage') && (
              <Button
                variant="secondary"
                onClick={() => setDialog('vendor')}
                icon={<Plus className="h-4 w-4" />}
              >
                Add vendor
              </Button>
            )}
            {can('purchase.manage') && (
              <Button onClick={() => setDialog('purchase')} icon={<Plus className="h-4 w-4" />}>
                Record purchase
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="px-4 pt-3">
          <Tabs
            value={tab}
            onChange={(t) => set({ tab: t, search: '', vendorId: '' })}
            tabs={[
              { value: 'purchases', label: 'Purchases', hidden: !can('purchase.view') },
              { value: 'vendors', label: 'Vendors', hidden: !can('vendor.view') },
            ]}
          />
        </div>
        <FilterBar
          search={params.search}
          onSearch={(search) => set({ search })}
          placeholder={tab === 'purchases' ? 'Order, invoice, vendor…' : 'Name, contact, email…'}
        >
          {tab === 'purchases' && (
            <VendorSelect
              placeholder="All vendors"
              value={params.vendorId}
              onChange={(e) => set({ vendorId: e.target.value })}
              aria-label="Vendor"
            />
          )}
        </FilterBar>
        {tab === 'purchases' ? (
          <DataTable
            caption="Purchases"
            columns={purchaseColumns}
            rows={purchases.data?.data}
            loading={purchases.isFetching}
            error={purchases.error}
            onRowClick={(p) => router.push(`/purchases/${p.id}`)}
            meta={purchases.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={<EmptyState title="No purchases recorded" />}
          />
        ) : (
          <DataTable
            caption="Vendors"
            columns={vendorColumns}
            rows={vendors.data?.data}
            loading={vendors.isFetching}
            error={vendors.error}
            onRowClick={can('vendor.manage') ? setEditVendor : undefined}
            meta={vendors.data?.meta}
            onPage={(page) => set({ page: String(page) })}
            empty={<EmptyState title="No vendors yet" />}
          />
        )}
      </Card>
      <PurchaseDialog open={dialog === 'purchase'} onClose={() => setDialog(null)} />
      <VendorDialog
        open={dialog === 'vendor' || !!editVendor}
        onClose={() => {
          setDialog(null);
          setEditVendor(null);
        }}
        vendor={editVendor ?? undefined}
      />
    </>
  );
}
