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
import { fullName } from '@/lib/format';
import type { AssetListItem, SimCard, SimPlan, SimSwap, SimUsage } from '@/lib/types';

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

// ── Swap ─────────────────────────────────────────────────────────────────────

/** What the ticked reason asks to be written on the printed form. */
const REASON_DETAIL: Record<string, string> = {
  LOW_USAGE: 'Usage to note',
  STOLEN: 'Police report number',
  LOST: 'What happened',
  DAMAGED: 'What is wrong with it',
  UPGRADE: 'New device or eSIM',
  OTHER: 'Detail',
};

interface SwapValues {
  reason: string;
  reasonDetail: string;
  newSimNumber: string;
  swappedAt: string;
  remarks: string;
}

/**
 * Hands a line over to another employee: records the swap, moves the SIM and prepares the printed
 * SIM CARD SWAP REQUEST FORM.
 */
export function SimSwapDialog({
  open,
  card,
  onClose,
}: {
  open: boolean;
  card: SimCard;
  onClose: (swap?: SimSwap) => void;
}) {
  const toast = useToast();
  const [toEmployeeId, setToEmployeeId] = useState<string | null>(null);
  const mutation = useApiMutation<Record<string, unknown>, SimSwap>(
    'post',
    `/sim-cards/${card.id}/swaps`,
    ['/sim-cards', '/sim-swaps', `/sim-cards/${card.id}`],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<SwapValues>();
  const reason = watch('reason') || 'OTHER';

  useEffect(() => {
    if (!open) return;
    reset({
      reason: 'OTHER',
      reasonDetail: '',
      newSimNumber: '',
      swappedAt: new Date().toISOString().slice(0, 10),
      remarks: '',
    });
    setToEmployeeId(null);
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const { data } = await mutation.mutateAsync({
        toEmployeeId,
        reason: v.reason,
        reasonDetail: v.reasonDetail || undefined,
        newSimNumber: v.newSimNumber || undefined,
        swappedAt: v.swappedAt || undefined,
        remarks: v.remarks || undefined,
      });
      toast.success('Swap recorded — the request form is ready to print');
      onClose(data);
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'reason', { message: m });
        setError('root', {
          message:
            e.code === 'SIM_IN_USE' ? 'Another line already has this SIM number.' : e.message,
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      size="lg"
      title={`Swap ${card.phoneNumber}`}
      description={
        card.employee
          ? `${fullName(card.employee)} hands the line over. Leave the new holder empty to take it back into stock.`
          : 'The line is in stock. Choose who receives it.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            Record swap
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Received by (new holder)" error={errors.reason?.message}>
            {(p) => (
              <EmployeePicker
                id={p.id}
                value={toEmployeeId}
                onChange={setToEmployeeId}
                placeholder="Back into stock"
              />
            )}
          </Field>
          <Field label="Reason for swap">
            {(p) => (
              <EnumSelect
                {...p}
                group="simSwapReason"
                exclude={['TRANSFER']}
                {...register('reason')}
              />
            )}
          </Field>
          <Field label={REASON_DETAIL[reason] ?? 'Detail'}>
            {(p) => <Input {...p} {...register('reasonDetail')} />}
          </Field>
          <Field label="Replacement SIM (ICCID)" hint="Only if the physical card changed">
            {(p) => <Input {...p} className="font-mono" {...register('newSimNumber')} />}
          </Field>
          <Field label="Swapped on" error={errors.swappedAt?.message}>
            {(p) => <Input {...p} type="date" {...register('swappedAt')} />}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ── Transfer ─────────────────────────────────────────────────────────────────

/** Phones and tablets are the devices a SIM normally goes into. */
const PHONE_CATEGORIES = ['MOBILE', 'TABLET'];

/**
 * Moves a line to another employee the way an asset is transferred: it becomes theirs and goes into
 * the device they hold, which is filled in as soon as they are chosen.
 */
export function SimTransferDialog({
  open,
  card,
  onClose,
}: {
  open: boolean;
  card: SimCard;
  onClose: (swap?: SimSwap) => void;
}) {
  const toast = useToast();
  const [toEmployeeId, setToEmployeeId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [transferredAt, setTransferredAt] = useState('');
  // What the new holder has now, so the line follows them into their own device.
  const held = useApi<AssetListItem[]>(open && toEmployeeId ? '/assets' : null, {
    employeeId: toEmployeeId ?? undefined,
    limit: 20,
  });
  const theirAssets = held.data?.data ?? [];
  const mutation = useApiMutation<Record<string, unknown>, SimSwap>(
    'post',
    `/sim-cards/${card.id}/transfer`,
    ['/sim-cards', '/sim-swaps', `/sim-cards/${card.id}`],
  );

  useEffect(() => {
    if (!open) return;
    setToEmployeeId(null);
    setAssetId(null);
    setError(null);
    setRemarks('');
    setTransferredAt(new Date().toISOString().slice(0, 10));
  }, [open]);

  // Their phone or tablet if they have one, otherwise the newest asset they hold.
  useEffect(() => {
    if (!theirAssets.length) return;
    const phone = theirAssets.find((a) => PHONE_CATEGORIES.includes(a.assetType.category));
    setAssetId((phone ?? theirAssets[0]).id);
  }, [theirAssets]);

  const submit = async () => {
    if (!toEmployeeId) {
      setError('Choose who the line is transferred to');
      return;
    }
    try {
      const { data } = await mutation.mutateAsync({
        toEmployeeId,
        assetId,
        transferredAt: transferredAt || undefined,
        remarks: remarks || undefined,
      });
      toast.success('Line transferred');
      onClose(data);
    } catch (e) {
      toast.error(e);
    }
  };

  const device = theirAssets.find((a) => a.id === assetId);

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      size="lg"
      title={`Transfer ${card.phoneNumber}`}
      description="The line becomes the new holder's and moves into their device."
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Transfer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormGrid>
          <Field label="Transferred to" required error={error ?? undefined}>
            {(p) => (
              <EmployeePicker
                id={p.id}
                value={toEmployeeId}
                onChange={(id) => {
                  setToEmployeeId(id);
                  setAssetId(null);
                  setError(null);
                }}
                placeholder="Search employees…"
              />
            )}
          </Field>
          <Field
            label="In device"
            hint={
              toEmployeeId
                ? device
                  ? `${device.assetType.name} held by the new holder`
                  : 'The new holder has no device; the line goes into none'
                : 'Filled in from what the new holder has'
            }
          >
            {(p) => (
              <AssetPicker
                id={p.id}
                value={assetId}
                onChange={setAssetId}
                initialLabel={device ? `${device.assetTag} — ${device.name}` : undefined}
                placeholder="No device"
              />
            )}
          </Field>
          <Field label="Transferred on">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={transferredAt}
                onChange={(e) => setTransferredAt(e.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
