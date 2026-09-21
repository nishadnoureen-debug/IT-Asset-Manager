'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { EnumSelect, VendorSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Checkbox,
  Field,
  FormError,
  FormGrid,
  Input,
  Select,
  Textarea,
} from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { License, Software } from '@/lib/types';

export function LicenseDialog({
  open,
  onClose,
  license,
}: {
  open: boolean;
  onClose: () => void;
  license?: License;
}) {
  const toast = useToast();
  const router = useRouter();
  const editing = !!license;
  const software = useApi<Software[]>(open ? '/software' : null, { limit: 100 });
  const mutation = useApiMutation<Record<string, unknown>, License>(
    editing ? 'patch' : 'post',
    editing ? `/licenses/${license.id}` : '/licenses',
    ['/licenses', '/software'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<Record<string, string | boolean>>();

  useEffect(() => {
    if (!open) return;
    reset({
      softwareId: license?.softwareId ?? '',
      name: license?.name ?? '',
      licenseType: license?.licenseType ?? 'SUBSCRIPTION',
      seats: license?.seats != null ? String(license.seats) : '',
      unlimited: license ? license.seats === null : false,
      allowOverAllocation: license?.allowOverAllocation ?? false,
      vendorId: license?.vendorId ?? '',
      startDate: license?.startDate?.slice(0, 10) ?? '',
      expiryDate: license?.expiryDate?.slice(0, 10) ?? '',
      cost: license?.cost != null ? String(license.cost) : '',
      licenseKey: '',
      notes: license?.notes ?? '',
    });
  }, [open, license, reset]);

  const unlimited = watch('unlimited') as boolean;

  const onSubmit = handleSubmit(async (v) => {
    const body: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(v))
      if (value !== '' && k !== 'unlimited') body[k] = value;
    body.seats = v.unlimited ? null : v.seats === '' ? undefined : Number(v.seats);
    if (body.cost !== undefined) body.cost = Number(body.cost);
    if (editing) delete body.softwareId;
    try {
      const { data } = await mutation.mutateAsync(body);
      toast.success(editing ? 'Licence updated' : 'Licence added');
      onClose();
      if (!editing) router.push(`/software/licenses/${data.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f, { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit licence' : 'Add licence'}
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
          <Field label="Software" required error={errors.softwareId?.message as string | undefined}>
            {(p) => (
              <Select
                {...p}
                disabled={editing}
                {...register('softwareId', { required: 'Choose software' })}
              >
                <option value="">Select…</option>
                {(software.data?.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {[s.name, s.version].filter(Boolean).join(' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Licence name">
            {(p) => <Input {...p} placeholder="e.g. Annual team plan" {...register('name')} />}
          </Field>
          <Field label="Type" required>
            {(p) => <EnumSelect {...p} group="licenseType" {...register('licenseType')} />}
          </Field>
          <Field label="Vendor">
            {(p) => <VendorSelect {...p} placeholder="None" {...register('vendorId')} />}
          </Field>
          <Field label="Seats" hint={unlimited ? 'Unlimited' : undefined}>
            {(p) => (
              <Input {...p} type="number" min="0" disabled={unlimited} {...register('seats')} />
            )}
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Checkbox label="Unlimited seats" {...register('unlimited')} />
            <Checkbox label="Allow over-allocation" {...register('allowOverAllocation')} />
          </div>
          <Field label="Start date">
            {(p) => <Input {...p} type="date" {...register('startDate')} />}
          </Field>
          <Field label="Expiry date" error={errors.expiryDate?.message as string | undefined}>
            {(p) => <Input {...p} type="date" {...register('expiryDate')} />}
          </Field>
          <Field label="Cost">
            {(p) => <Input {...p} type="number" min="0" step="0.01" {...register('cost')} />}
          </Field>
          <Field
            label="Licence key"
            hint={editing ? 'Leave empty to keep the current key' : 'Stored encrypted'}
          >
            {(p) => <Input {...p} type="password" autoComplete="off" {...register('licenseKey')} />}
          </Field>
        </FormGrid>
        <Field label="Notes">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}
