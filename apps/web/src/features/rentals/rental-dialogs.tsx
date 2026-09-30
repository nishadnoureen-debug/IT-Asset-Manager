'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { EmployeePicker, EnumSelect } from '@/components/pickers';
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
import type { Camp, Rental, RentalItem } from '@/lib/types';

const number = (value: string) => (value === '' ? undefined : Number(value));

/** yyyy-mm-ddThh:mm in the browser's own time zone, for <input type="datetime-local">. */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** The instant a datetime-local value stands for. */
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : undefined);

// ── Camp ─────────────────────────────────────────────────────────────────────

interface CampValues {
  name: string;
  code: string;
  location: string;
  remarks: string;
  isActive: boolean;
}

export function CampDialog({
  open,
  camp,
  onClose,
}: {
  open: boolean;
  camp?: Camp | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!camp;
  const mutation = useApiMutation<Record<string, unknown>, Camp>(
    editing ? 'patch' : 'post',
    editing ? `/camps/${camp.id}` : '/camps',
    ['/camps', '/rental-items'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CampValues>();

  useEffect(() => {
    if (open)
      reset({
        name: camp?.name ?? '',
        code: camp?.code ?? '',
        location: camp?.location ?? '',
        remarks: camp?.remarks ?? '',
        isActive: camp?.isActive ?? true,
      });
  }, [open, camp, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync({
        name: v.name,
        code: v.code || undefined,
        location: v.location || undefined,
        remarks: v.remarks || undefined,
        isActive: v.isActive,
      });
      toast.success(editing ? 'Camp updated' : 'Camp added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'name', { message: m });
        setError('root', {
          message:
            e.code === 'CONFLICT' ? 'A camp with this name or code already exists.' : e.message,
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${camp.name}` : 'Add a camp'}
      description="Where the WiFi cards and washing machines are."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Add camp'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Camp name" required error={errors.name?.message}>
            {(p) => (
              <Input
                {...p}
                placeholder="e.g. Jebel Ali Camp"
                {...register('name', { required: 'Required' })}
              />
            )}
          </Field>
          <Field label="Code">
            {(p) => <Input {...p} placeholder="e.g. JAC" {...register('code')} />}
          </Field>
          <Field label="Location">
            {(p) => <Input {...p} placeholder="e.g. Jebel Ali, Dubai" {...register('location')} />}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
        <Checkbox label="Camp is in use" {...register('isActive')} />
      </form>
    </Dialog>
  );
}

// ── Item ─────────────────────────────────────────────────────────────────────

interface ItemValues {
  campId: string;
  type: string;
  name: string;
  code: string;
  provider: string;
  standardCharge: string;
  status: string;
  remarks: string;
}

export function RentalItemDialog({
  open,
  item,
  campId,
  onClose,
}: {
  open: boolean;
  item?: RentalItem | null;
  /** The camp the list is filtered to, used for a new item. */
  campId?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!item;
  const camps = useApi<Camp[]>(open ? '/camps' : null, { limit: 100 });
  const mutation = useApiMutation<Record<string, unknown>, RentalItem>(
    editing ? 'patch' : 'post',
    editing ? `/rental-items/${item.id}` : '/rental-items',
    ['/rental-items', '/rentals', '/camps'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<ItemValues>();
  const type = watch('type');

  useEffect(() => {
    if (open)
      reset({
        campId: item?.campId ?? campId ?? '',
        type: item?.type ?? 'WIFI_CARD',
        name: item?.name ?? '',
        code: item?.code ?? '',
        provider: item?.provider ?? '',
        standardCharge: item ? String(item.standardCharge) : '',
        status: item?.status ?? 'AVAILABLE',
        remarks: item?.remarks ?? '',
      });
  }, [open, item, campId, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await mutation.mutateAsync({
        campId: v.campId,
        type: v.type,
        name: v.name,
        code: v.code || undefined,
        provider: v.provider || undefined,
        standardCharge: number(v.standardCharge),
        status: v.status,
        remarks: v.remarks || undefined,
      });
      toast.success(editing ? 'Item updated' : 'Item added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'name', { message: m });
        setError('root', {
          message: e.code === 'CONFLICT' ? 'Another item already has this number.' : e.message,
        });
      }
    }
  });

  const machine = type === 'WASHING_MACHINE';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${item.name}` : 'Add an item'}
      description="A WiFi card or a washing machine the camp rents to its employees."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Add item'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="Camp" required error={errors.campId?.message}>
            {(p) => (
              <Select {...p} {...register('campId', { required: 'Required' })}>
                <option value="">Choose a camp</option>
                {camps.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Type">
            {(p) => <EnumSelect {...p} group="rentalItemType" {...register('type')} />}
          </Field>
          <Field label="Name" required error={errors.name?.message}>
            {(p) => (
              <Input
                {...p}
                placeholder={machine ? 'e.g. Washing machine 1' : 'e.g. WiFi card 12'}
                {...register('name', { required: 'Required' })}
              />
            )}
          </Field>
          <Field label={machine ? 'Machine number' : 'Card number'}>
            {(p) => <Input {...p} className="font-mono" {...register('code')} />}
          </Field>
          <Field label={machine ? 'Brand' : 'Network'}>
            {(p) => (
              <Input
                {...p}
                placeholder={machine ? 'e.g. LG' : 'e.g. du'}
                {...register('provider')}
              />
            )}
          </Field>
          <Field
            label="Usual charge"
            hint={machine ? 'Per washing time' : 'Per month'}
            error={errors.standardCharge?.message}
          >
            {(p) => (
              <Input {...p} type="number" min={0} step="0.01" {...register('standardCharge')} />
            )}
          </Field>
          <Field label="Status">
            {(p) => <EnumSelect {...p} group="rentalItemStatus" {...register('status')} />}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ── Rental ───────────────────────────────────────────────────────────────────

interface RentalValues {
  itemId: string;
  startAt: string;
  endAt: string;
  charge: string;
  remarks: string;
}

/** One hour after the given local datetime value. */
function plusAnHour(value: string): string {
  if (!value) return '';
  const start = new Date(value);
  return toLocalInput(new Date(start.getTime() + 60 * 60_000));
}

export function RentalDialog({
  open,
  rental,
  itemId,
  campId,
  onClose,
}: {
  open: boolean;
  rental?: Rental | null;
  /** Pre-selected item, when the rental is started from one. */
  itemId?: string;
  campId?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const editing = !!rental;
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const items = useApi<RentalItem[]>(open && !editing ? '/rental-items' : null, {
    campId: campId || undefined,
    limit: 100,
  });
  const mutation = useApiMutation<Record<string, unknown>, Rental>(
    editing ? 'patch' : 'post',
    editing ? `/rentals/${rental.id}` : '/rentals',
    ['/rentals', '/rental-items'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RentalValues>();
  const chosenId = watch('itemId');
  const startAt = watch('startAt');
  const endAt = watch('endAt');
  const chosen = items.data?.data.find((i) => i.id === chosenId);
  const machine = (chosen?.type ?? rental?.item?.type) === 'WASHING_MACHINE';

  useEffect(() => {
    if (!open) return;
    reset({
      itemId: rental?.itemId ?? itemId ?? '',
      startAt: toLocalInput(rental?.startAt ?? new Date()),
      endAt: toLocalInput(rental?.endAt),
      charge: rental ? String(rental.charge) : '',
      remarks: rental?.remarks ?? '',
    });
    setEmployeeId(rental?.employeeId ?? null);
  }, [open, rental, itemId, reset]);

  // A washing time has an end; a card stays out until it comes back.
  useEffect(() => {
    if (!machine || editing || endAt || !startAt) return;
    setValue('endAt', plusAnHour(startAt));
  }, [machine, editing, endAt, startAt, setValue]);

  // The item's usual charge, ready to accept or change.
  useEffect(() => {
    if (chosen && !editing) setValue('charge', String(chosen.standardCharge));
  }, [chosen, editing, setValue]);

  const onSubmit = handleSubmit(async (v) => {
    if (!employeeId) {
      setError('root', { message: 'Choose who is renting it' });
      return;
    }
    try {
      await mutation.mutateAsync({
        ...(editing ? {} : { itemId: v.itemId, employeeId }),
        startAt: fromLocalInput(v.startAt),
        endAt: v.endAt ? fromLocalInput(v.endAt) : null,
        charge: number(v.charge),
        remarks: v.remarks || undefined,
      });
      toast.success(editing ? 'Rental updated' : 'Rental recorded');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as 'itemId', { message: m });
        setError('root', { message: e.message });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit the rental' : 'Record a rental'}
      description={
        machine
          ? 'The washing time this employee has the machine for.'
          : 'Leave the end empty while the item is still with the employee.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Record'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          {!editing && (
            <>
              <Field label="Item" required error={errors.itemId?.message}>
                {(p) => (
                  <Select {...p} {...register('itemId', { required: 'Required' })}>
                    <option value="">Choose an item</option>
                    {items.data?.data
                      .filter((i) => i.status === 'AVAILABLE' || i.id === chosenId)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.camp?.name ? `${i.camp.name} · ` : ''}
                          {i.name}
                          {i.code ? ` (${i.code})` : ''}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label="Rented to" required>
                {(p) => (
                  <EmployeePicker
                    id={p.id}
                    value={employeeId}
                    onChange={setEmployeeId}
                    placeholder="Search employees…"
                  />
                )}
              </Field>
            </>
          )}
          <Field
            label={machine ? 'Washing from' : 'Given out'}
            required
            error={errors.startAt?.message}
          >
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                {...register('startAt', { required: 'Required' })}
              />
            )}
          </Field>
          <Field
            label={machine ? 'Washing until' : 'Given back'}
            hint={machine ? undefined : 'Leave empty while it is still out'}
          >
            {(p) => <Input {...p} type="datetime-local" {...register('endAt')} />}
          </Field>
          <Field label="Charge" error={errors.charge?.message}>
            {(p) => <Input {...p} type="number" min={0} step="0.01" {...register('charge')} />}
          </Field>
        </FormGrid>
        <Field label="Remarks">
          {(p) => <Textarea {...p} rows={2} {...register('remarks')} />}
        </Field>
      </form>
    </Dialog>
  );
}

// ── Taking it back ───────────────────────────────────────────────────────────

export function EndRentalDialog({
  open,
  rental,
  onClose,
}: {
  open: boolean;
  rental: Rental;
  onClose: () => void;
}) {
  const toast = useToast();
  const [endAt, setEndAt] = useState('');
  const [charge, setCharge] = useState('');
  const mutation = useApiMutation<Record<string, unknown>, Rental>(
    'post',
    `/rentals/${rental.id}/end`,
    ['/rentals', '/rental-items'],
  );

  useEffect(() => {
    if (!open) return;
    setEndAt(toLocalInput(new Date()));
    setCharge(String(rental.charge));
  }, [open, rental]);

  const submit = async () => {
    try {
      await mutation.mutateAsync({ endAt: fromLocalInput(endAt), charge: number(charge) });
      toast.success('Taken back');
      onClose();
    } catch (e) {
      toast.error(e);
    }
  };

  const machine = rental.item?.type === 'WASHING_MACHINE';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={machine ? 'Finish the washing time' : `Take back ${rental.item?.name ?? 'the item'}`}
      description="The item is free for the next employee once this is recorded."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {machine ? 'Finish' : 'Take back'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field label={machine ? 'Finished at' : 'Given back'} required>
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          )}
        </Field>
        <Field label="Charge">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              step="0.01"
              value={charge}
              onChange={(e) => setCharge(e.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </Dialog>
  );
}
