'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AssetPicker, EnumSelect, StaffSelect, VendorSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, FormGrid, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/hooks';
import type { MaintenanceRecord } from '@/lib/types';

interface Values {
  title: string;
  type: string;
  priority: string;
  description: string;
  technicianId: string;
  vendorId: string;
  scheduledAt: string;
  isWarrantyClaim: boolean;
  startNow: boolean;
}

/** Log a repair / preventive job for an asset. */
export function MaintenanceDialog({
  open,
  onClose,
  asset,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  asset?: { id: string; assetTag: string };
  onCreated?: (record: MaintenanceRecord) => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const [assetId, setAssetId] = useState<string | null>(asset?.id ?? null);
  const mutation = useApiMutation<Record<string, unknown>, MaintenanceRecord>(
    'post',
    '/maintenance',
    ['/maintenance', '/assets'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { type: 'REPAIR', priority: 'MEDIUM', startNow: true, isWarrantyClaim: false },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    const id = asset?.id ?? assetId;
    if (!id) return setError('root', { message: 'Choose an asset' });
    try {
      const { data } = await mutation.mutateAsync({
        assetId: id,
        title: v.title,
        type: v.type,
        priority: v.priority,
        description: v.description || undefined,
        technicianId: v.technicianId || undefined,
        vendorId: v.vendorId || undefined,
        scheduledAt: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : undefined,
        isWarrantyClaim: v.isWarrantyClaim,
        startNow: v.startNow,
      });
      toast.success(
        v.startNow ? 'Maintenance started — asset is now in repair' : 'Maintenance scheduled',
      );
      onCreated?.(data);
      close();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [f, m] of Object.entries(error.fieldErrors))
          setError(f as keyof Values, { message: m });
        setError('root', { message: error.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Log maintenance"
      description={asset ? `For ${asset.assetTag}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
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
        {!asset && (
          <Field label="Asset" required>
            {(p) => <AssetPicker id={p.id} value={assetId} onChange={(id) => setAssetId(id)} />}
          </Field>
        )}
        <Field label="Title" error={errors.title?.message} required>
          {(p) => (
            <Input
              {...p}
              placeholder="e.g. Screen flickering"
              {...register('title', {
                required: 'Describe the job',
                minLength: { value: 3, message: 'Too short' },
              })}
            />
          )}
        </Field>
        <FormGrid>
          <Field label="Type">
            {(p) => <EnumSelect {...p} group="maintenanceType" {...register('type')} />}
          </Field>
          <Field label="Priority">
            {(p) => <EnumSelect {...p} group="priority" {...register('priority')} />}
          </Field>
          <Field label="Technician">
            {(p) => <StaffSelect {...p} {...register('technicianId')} />}
          </Field>
          {can('vendor.view') && (
            <Field label="Vendor / repair shop">
              {(p) => <VendorSelect {...p} placeholder="In-house" {...register('vendorId')} />}
            </Field>
          )}
          <Field label="Scheduled for">
            {(p) => <Input {...p} type="datetime-local" {...register('scheduledAt')} />}
          </Field>
        </FormGrid>
        <Field label="Details">
          {(p) => <Textarea {...p} rows={3} {...register('description')} />}
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <Checkbox label="Start work now (asset moves to In repair)" {...register('startNow')} />
          <Checkbox label="Warranty claim" {...register('isWarrantyClaim')} />
        </div>
      </form>
    </Dialog>
  );
}
