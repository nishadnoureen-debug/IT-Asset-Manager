'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AssetPicker, EmployeePicker, EnumSelect } from '@/components/pickers';
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
import type { SimCard, SimPlan, SimUsage } from '@/lib/types';

/** The charge columns, in the order they are entered and printed. */
export const CHARGE_FIELDS = [
  { key: 'monthlyCharge', label: 'Monthly charges' },
  { key: 'excessUsage', label: 'Excess usage' },
  { key: 'internationalCharges', label: 'International charges' },
  { key: 'roamingCharges', label: 'Roaming charges' },
  { key: 'parkingCharges', label: 'Parking charges' },
] as const;

const number = (value: string) => (value === '' ? undefined : Number(value));

// ── Rate plan ────────────────────────────────────────────────────────────────

interface PlanValues {
  name: string;
  provider: string;
  monthlyCharge: string;
  remarks: string;
  isActive: boolean;
}

export function SimPlanDialog({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan?: SimPlan | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!plan;
  const mutation = useApiMutation<Record<string, unknown>, SimPlan>(
    editing ? 'patch' : 'post',
    editing ? `/sim-plans/${plan.id}` : '/sim-plans',
    ['/sim-plans', '/sim-cards'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PlanValues>();

  useEffect(() => {
    if (open)
      reset({
        name: plan?.name ?? '',
        provider: plan?.provider ?? '',
        monthlyCharge: plan ? String(plan.monthlyCharge) : '',
        remarks: plan?.remarks ?? '',
        isActive: plan?.isActive ?? true,
      });
  }, [open, plan, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync({
        name: v.name,
        provider: v.provider || undefined,
        monthlyCharge: number(v.monthlyCharge),
        remarks: v.remarks || undefined,
        isActive: v.isActive,
      });
      toast.success(editing ? 'Rate plan updated' : 'Rate plan added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'name', { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${plan.name}` : 'Add a rate plan'}
      description="The standing monthly charge the carrier bills for this plan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Add plan'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Plan name" required error={errors.name?.message}>
            {(p) => (
              <Input
                {...p}
                placeholder="e.g. Business 150"
                {...register('name', { required: 'Required' })}
              />
            )}
          </Field>
          <Field label="Provider">
            {(p) => <Input {...p} placeholder="e.g. Etisalat" {...register('provider')} />}
          </Field>
          <Field label="Monthly charge" error={errors.monthlyCharge?.message}>
            {(p) => (
              <Input {...p} type="number" min={0} step="0.01" {...register('monthlyCharge')} />
            )}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
        <Checkbox label="Plan is available for new SIMs" {...register('isActive')} />
      </form>
    </Dialog>
  );
}

// ── SIM card ─────────────────────────────────────────────────────────────────

interface CardValues {
  phoneNumber: string;
  simNumber: string;
  provider: string;
  planId: string;
  status: string;
  activatedAt: string;
  remarks: string;
}

export function SimCardDialog({
  open,
  card,
  onClose,
}: {
  open: boolean;
  card?: SimCard | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!card;
  const plans = useApi<SimPlan[]>(open ? '/sim-plans' : null, { limit: 100 });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const mutation = useApiMutation<Record<string, unknown>, SimCard>(
    editing ? 'patch' : 'post',
    editing ? `/sim-cards/${card.id}` : '/sim-cards',
    ['/sim-cards', '/sim-usages'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CardValues>();

  useEffect(() => {
    if (!open) return;
    reset({
      phoneNumber: card?.phoneNumber ?? '',
      simNumber: card?.simNumber ?? '',
      provider: card?.provider ?? '',
      planId: card?.planId ?? '',
      status: card?.status ?? 'SPARE',
      activatedAt: card?.activatedAt ? card.activatedAt.slice(0, 10) : '',
      remarks: card?.remarks ?? '',
    });
    setEmployeeId(card?.employeeId ?? null);
    setAssetId(card?.assetId ?? null);
  }, [open, card, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync({
        phoneNumber: v.phoneNumber,
        simNumber: v.simNumber || undefined,
        provider: v.provider || undefined,
        planId: v.planId || null,
        status: v.status,
        activatedAt: v.activatedAt || null,
        remarks: v.remarks || undefined,
        employeeId,
        assetId,
      });
      toast.success(editing ? 'SIM updated' : 'SIM added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors))
          setError(f as 'phoneNumber', { message: m });
        setError('root', {
          message:
            e.code === 'CONFLICT' ? 'A SIM with this number or ICCID already exists.' : e.message,
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${card.phoneNumber}` : 'Add a SIM card'}
      description="The line, the plan it is on, and who is using it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Add SIM'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Phone number" required error={errors.phoneNumber?.message}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                placeholder="05xxxxxxxx"
                {...register('phoneNumber', { required: 'Required' })}
              />
            )}
          </Field>
          <Field label="SIM number (ICCID)" error={errors.simNumber?.message}>
            {(p) => <Input {...p} className="font-mono" {...register('simNumber')} />}
          </Field>
          <Field label="Provider">
            {(p) => <Input {...p} placeholder="e.g. Etisalat" {...register('provider')} />}
          </Field>
          <Field label="Rate plan">
            {(p) => (
              <Select {...p} {...register('planId')}>
                <option value="">No plan</option>
                {plans.data?.data.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(p) => <EnumSelect {...p} group="simStatus" {...register('status')} />}
          </Field>
          <Field label="Activated on">
            {(p) => <Input {...p} type="date" {...register('activatedAt')} />}
          </Field>
          <Field label="Used by">
            {(p) => (
              <EmployeePicker
                id={p.id}
                value={employeeId}
                onChange={setEmployeeId}
                placeholder="Nobody yet"
              />
            )}
          </Field>
          <Field label="In device">
            {(p) => (
              <AssetPicker id={p.id} value={assetId} onChange={setAssetId} placeholder="Optional" />
            )}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ── Monthly usage ────────────────────────────────────────────────────────────

type UsageValues = Record<(typeof CHARGE_FIELDS)[number]['key'], string> & {
  period: string;
  remarks: string;
};

export function SimUsageDialog({
  open,
  simCardId,
  usage,
  planCharge,
  onClose,
}: {
  open: boolean;
  simCardId: string;
  usage?: SimUsage | null;
  /** Pre-fills the monthly charge for a new month. */
  planCharge?: string | number | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!usage;
  const mutation = useApiMutation<Record<string, unknown>, SimUsage>(
    editing ? 'patch' : 'post',
    editing ? `/sim-usages/${usage.id}` : `/sim-cards/${simCardId}/usages`,
    ['/sim-cards', '/sim-usages'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<UsageValues>();

  useEffect(() => {
    if (!open) return;
    const month = (usage?.period ?? new Date().toISOString()).slice(0, 7);
    reset({
      period: month,
      monthlyCharge: String(usage?.monthlyCharge ?? planCharge ?? ''),
      excessUsage: String(usage?.excessUsage ?? ''),
      internationalCharges: String(usage?.internationalCharges ?? ''),
      roamingCharges: String(usage?.roamingCharges ?? ''),
      parkingCharges: String(usage?.parkingCharges ?? ''),
      remarks: usage?.remarks ?? '',
    } as UsageValues);
  }, [open, usage, planCharge, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync({
        period: `${v.period}-01`,
        monthlyCharge: number(v.monthlyCharge),
        excessUsage: number(v.excessUsage),
        internationalCharges: number(v.internationalCharges),
        roamingCharges: number(v.roamingCharges),
        parkingCharges: number(v.parkingCharges),
        remarks: v.remarks || undefined,
      });
      toast.success(editing ? 'Month updated' : 'Month recorded');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'period', { message: m });
        setError('root', {
          message:
            e.code === 'USAGE_EXISTS' ? 'This month is already recorded for this SIM.' : e.message,
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit the month' : 'Record a month'}
      description="Charges from the carrier bill for this line."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Record month'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Billing month" required error={errors.period?.message}>
            {(p) => <Input {...p} type="month" {...register('period', { required: 'Required' })} />}
          </Field>
          {CHARGE_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} error={errors[field.key]?.message}>
              {(p) => <Input {...p} type="number" min={0} step="0.01" {...register(field.key)} />}
            </Field>
          ))}
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
      </form>
    </Dialog>
  );
}
