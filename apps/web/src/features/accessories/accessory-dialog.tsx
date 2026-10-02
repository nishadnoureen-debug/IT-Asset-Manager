'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { EnumSelect, LocationSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useApiMutation } from '@/lib/hooks';
import type { Accessory } from '@/lib/types';

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

/** Add an accessory or change its details and stock. */
export function AccessoryDialog({
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
