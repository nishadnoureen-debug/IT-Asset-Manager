'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { AppSettings } from '@itam/shared';
import {
  AssetTypeSelect,
  DepartmentSelect,
  EnumSelect,
  LocationSelect,
  VendorSelect,
} from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { toDateInput } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { AssetDetail, Purchase } from '@/lib/types';

export interface AssetFormValues {
  assetTag: string;
  name: string;
  assetTypeId: string;
  serialNumber: string;
  serviceTag: string;
  brand: string;
  model: string;
  phoneNumber: string;
  status: string;
  condition: string;
  locationId: string;
  departmentId: string;
  purchaseId: string;
  vendorId: string;
  purchaseDate: string;
  purchaseCost: string;
  currency: string;
  warrantyProviderId: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
  warrantyCoverage: string;
  warrantyReference: string;
  notes: string;
}

function toValues(a?: AssetDetail): Partial<AssetFormValues> {
  if (!a) return { status: 'IN_STOCK', condition: 'NEW' };
  return {
    assetTag: a.assetTag,
    name: a.name,
    assetTypeId: a.assetTypeId,
    serialNumber: a.serialNumber ?? '',
    serviceTag: a.serviceTag ?? '',
    brand: a.brand ?? '',
    model: a.model ?? '',
    phoneNumber: a.phoneNumber ?? '',
    status: a.status,
    condition: a.condition,
    locationId: a.locationId ?? '',
    departmentId: a.departmentId ?? '',
    purchaseId: a.purchaseId ?? '',
    vendorId: a.vendorId ?? '',
    purchaseDate: toDateInput(a.purchaseDate),
    purchaseCost: a.purchaseCost !== null ? String(a.purchaseCost) : '',
    currency: a.currency ?? '',
    warrantyProviderId: a.warrantyProviderId ?? '',
    warrantyStartDate: toDateInput(a.warrantyStartDate),
    warrantyEndDate: toDateInput(a.warrantyEndDate),
    warrantyCoverage: a.warrantyCoverage ?? '',
    warrantyReference: a.warrantyReference ?? '',
    notes: a.notes ?? '',
  };
}

/** Build the request body: drop empty strings; never resend the immutable tag or an unchanged status. */
function toBody(v: AssetFormValues, original?: AssetDetail) {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(v)) {
    if (value === '' || value === undefined) continue;
    body[key] = value;
  }
  if (body.purchaseCost !== undefined) body.purchaseCost = Number(body.purchaseCost);
  if (original) {
    delete body.assetTag;
    // Status is only sent when it actually changes (workflow statuses are changed through actions).
    if (body.status === original.status) delete body.status;
  }
  return body;
}

const EDITABLE_STATUSES = ['PURCHASED', 'REGISTERED', 'IN_STOCK', 'AVAILABLE'];

export function AssetForm({ asset }: { asset?: AssetDetail }) {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const editing = !!asset;
  const settings = useApi<AppSettings>('/settings', undefined, { staleTime: 300_000 });
  const purchases = useApi<Purchase[]>(can('purchase.view') ? '/purchases' : null, { limit: 100 });
  const mutation = useApiMutation<Record<string, unknown>, AssetDetail>(
    editing ? 'patch' : 'post',
    editing ? `/assets/${asset.id}` : '/assets',
    ['/assets'],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AssetFormValues>({ defaultValues: toValues(asset) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { data } = await mutation.mutateAsync(toBody(values, asset));
      toast.success(editing ? 'Asset updated' : `Asset ${data.assetTag} registered`);
      router.push(`/assets/${data.id}`);
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof AssetFormValues, { message });
        }
        setError('root', {
          message:
            error.code === 'CONFLICT'
              ? 'An asset with this tag or serial number already exists.'
              : error.message,
        });
      } else setError('root', { message: 'Save failed' });
    }
  });

  const statusLocked = editing && !EDITABLE_STATUSES.includes(asset.status);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FormError message={errors.root?.message} />
      <Card>
        <CardHeader title="Identification" />
        <CardBody>
          <FormGrid>
            <Field label="Name" error={errors.name?.message} required>
              {(p) => (
                <Input
                  {...p}
                  placeholder="e.g. Latitude 7440"
                  {...register('name', { required: 'Name is required', maxLength: 160 })}
                />
              )}
            </Field>
            <Field label="Asset type" error={errors.assetTypeId?.message} required>
              {(p) => (
                <AssetTypeSelect
                  {...p}
                  {...register('assetTypeId', { required: 'Choose a type' })}
                />
              )}
            </Field>
            <Field
              label="Asset tag"
              error={errors.assetTag?.message}
              hint={
                editing
                  ? 'Asset tags cannot be changed'
                  : 'Leave empty to generate one automatically'
              }
            >
              {(p) => (
                <Input
                  {...p}
                  disabled={editing}
                  placeholder={`${settings.data?.data.assetTagPrefix ?? 'AST'}-000123`}
                  className="uppercase"
                  {...register('assetTag')}
                />
              )}
            </Field>
            <Field label="Serial number" error={errors.serialNumber?.message}>
              {(p) => <Input {...p} className="font-mono" {...register('serialNumber')} />}
            </Field>
            <Field label="Brand" error={errors.brand?.message}>
              {(p) => <Input {...p} {...register('brand')} />}
            </Field>
            <Field label="Model" error={errors.model?.message}>
              {(p) => <Input {...p} {...register('model')} />}
            </Field>
            <Field label="Service tag" error={errors.serviceTag?.message}>
              {(p) => <Input {...p} {...register('serviceTag')} />}
            </Field>
            <Field
              label="Phone number"
              hint="SIM / line number for phones and tablets (printed on handover forms)"
              error={errors.phoneNumber?.message}
            >
              {(p) => <Input {...p} type="tel" {...register('phoneNumber')} />}
            </Field>
            <Field label="Condition" error={errors.condition?.message}>
              {(p) => <EnumSelect {...p} group="assetCondition" {...register('condition')} />}
            </Field>
            <Field
              label="Status"
              error={errors.status?.message}
              hint={
                statusLocked
                  ? 'Changed through assign/return/maintenance/retire actions'
                  : undefined
              }
            >
              {(p) =>
                statusLocked ? (
                  <Input
                    {...p}
                    disabled
                    value={asset.status.replace('_', ' ').toLowerCase()}
                    readOnly
                  />
                ) : (
                  <EnumSelect
                    {...p}
                    group="assetStatus"
                    exclude={[
                      'ASSIGNED',
                      'IN_REPAIR',
                      'LOST',
                      'RETIRED',
                      'DISPOSED',
                      ...(editing ? [] : ['AVAILABLE']),
                    ]}
                    {...register('status')}
                  />
                )
              }
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Location & ownership" />
        <CardBody>
          <FormGrid>
            <Field label="Location" error={errors.locationId?.message}>
              {(p) => <LocationSelect {...p} placeholder="Not set" {...register('locationId')} />}
            </Field>
            <Field label="Owning department" error={errors.departmentId?.message}>
              {(p) => (
                <DepartmentSelect {...p} placeholder="Not set" {...register('departmentId')} />
              )}
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Purchase" />
        <CardBody>
          <FormGrid>
            {can('vendor.view') && (
              <Field label="Vendor" error={errors.vendorId?.message}>
                {(p) => <VendorSelect {...p} placeholder="Not set" {...register('vendorId')} />}
              </Field>
            )}
            {can('purchase.view') && (
              <Field label="Purchase order" error={errors.purchaseId?.message}>
                {(p) => (
                  <Select {...p} {...register('purchaseId')}>
                    <option value="">Not linked</option>
                    {(purchases.data?.data ?? []).map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.orderNumber ?? po.invoiceNumber ?? po.id.slice(0, 8)} · {po.vendor.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Purchase date" error={errors.purchaseDate?.message}>
              {(p) => <Input {...p} type="date" {...register('purchaseDate')} />}
            </Field>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Field label="Cost" error={errors.purchaseCost?.message}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    {...register('purchaseCost', {
                      min: { value: 0, message: 'Must be positive' },
                    })}
                  />
                )}
              </Field>
              <Field label="Currency" error={errors.currency?.message}>
                {(p) => (
                  <Input
                    {...p}
                    maxLength={3}
                    className="uppercase"
                    placeholder={settings.data?.data.defaultCurrency ?? 'AED'}
                    {...register('currency', {
                      pattern: { value: /^[A-Za-z]{3}$/, message: '3 letters' },
                    })}
                  />
                )}
              </Field>
            </div>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Warranty" />
        <CardBody>
          <FormGrid>
            {can('vendor.view') && (
              <Field label="Warranty provider" error={errors.warrantyProviderId?.message}>
                {(p) => (
                  <VendorSelect {...p} placeholder="Not set" {...register('warrantyProviderId')} />
                )}
              </Field>
            )}
            <Field label="Reference / contract no." error={errors.warrantyReference?.message}>
              {(p) => <Input {...p} {...register('warrantyReference')} />}
            </Field>
            <Field label="Start date" error={errors.warrantyStartDate?.message}>
              {(p) => <Input {...p} type="date" {...register('warrantyStartDate')} />}
            </Field>
            <Field label="End date" error={errors.warrantyEndDate?.message}>
              {(p) => <Input {...p} type="date" {...register('warrantyEndDate')} />}
            </Field>
            <Field
              label="Coverage"
              error={errors.warrantyCoverage?.message}
              className="sm:col-span-2"
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  placeholder="e.g. Next business day on-site, parts and labour"
                  {...register('warrantyCoverage')}
                />
              )}
            </Field>
          </FormGrid>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <CardBody>
          <Field label="Internal notes" error={errors.notes?.message}>
            {(p) => <Textarea {...p} rows={3} {...register('notes', { maxLength: 5000 })} />}
          </Field>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {editing ? 'Save changes' : 'Register asset'}
        </Button>
      </div>
    </form>
  );
}
