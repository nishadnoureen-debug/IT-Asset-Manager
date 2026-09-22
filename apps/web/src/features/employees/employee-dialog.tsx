'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { DepartmentSelect, EnumSelect, LocationSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, FormGrid, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-client';
import { toDateInput } from '@/lib/format';
import { useApiMutation } from '@/lib/hooks';
import type { Employee } from '@/lib/types';

interface Values {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  nationality: string;
  departmentId: string;
  locationId: string;
  status: string;
  hireDate: string;
}

const empty: Values = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  jobTitle: '',
  nationality: '',
  departmentId: '',
  locationId: '',
  status: 'ACTIVE',
  hireDate: '',
};

export function EmployeeDialog({
  open,
  onClose,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  employee?: Employee;
}) {
  const toast = useToast();
  const editing = !!employee;
  const mutation = useApiMutation<Record<string, unknown>, Employee>(
    editing ? 'patch' : 'post',
    editing ? `/employees/${employee.id}` : '/employees',
    ['/employees', '/assets'],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    reset(
      employee
        ? {
            employeeNumber: employee.employeeNumber,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            phone: employee.phone ?? '',
            jobTitle: employee.jobTitle ?? '',
            nationality: employee.nationality ?? '',
            departmentId: employee.departmentId ?? '',
            locationId: employee.locationId ?? '',
            status: employee.status,
            hireDate: toDateInput(employee.hireDate),
          }
        : empty,
    );
  }, [open, employee, reset]);

  const onSubmit = handleSubmit(async (v) => {
    const body = Object.fromEntries(Object.entries(v).filter(([, value]) => value !== ''));
    try {
      await mutation.mutateAsync(body);
      toast.success(editing ? 'Employee updated' : 'Employee added');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const [f, m] of Object.entries(e.fieldErrors))
          setError(f as keyof Values, { message: m });
        setError('root', {
          message:
            e.code === 'CONFLICT'
              ? 'An employee with this number or email already exists.'
              : e.message,
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'Edit employee' : 'Add employee'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mutation.isPending}>
            {editing ? 'Save' : 'Add employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError message={errors.root?.message} />
        <FormGrid>
          <Field label="First name" required error={errors.firstName?.message}>
            {(p) => <Input {...p} {...register('firstName', { required: 'Required' })} />}
          </Field>
          <Field label="Last name" required error={errors.lastName?.message}>
            {(p) => <Input {...p} {...register('lastName', { required: 'Required' })} />}
          </Field>
          <Field label="Employee number" required error={errors.employeeNumber?.message}>
            {(p) => (
              <Input
                {...p}
                className="uppercase"
                {...register('employeeNumber', { required: 'Required' })}
              />
            )}
          </Field>
          <Field label="Email" required error={errors.email?.message}>
            {(p) => <Input {...p} type="email" {...register('email', { required: 'Required' })} />}
          </Field>
          <Field label="Job title" error={errors.jobTitle?.message}>
            {(p) => <Input {...p} {...register('jobTitle')} />}
          </Field>
          <Field label="Nationality" error={errors.nationality?.message}>
            {(p) => <Input {...p} {...register('nationality')} />}
          </Field>
          <Field label="Phone" error={errors.phone?.message}>
            {(p) => <Input {...p} type="tel" {...register('phone')} />}
          </Field>
          <Field label="Department" error={errors.departmentId?.message}>
            {(p) => <DepartmentSelect {...p} placeholder="None" {...register('departmentId')} />}
          </Field>
          <Field label="Location" error={errors.locationId?.message}>
            {(p) => <LocationSelect {...p} placeholder="None" {...register('locationId')} />}
          </Field>
          <Field
            label="Status"
            error={errors.status?.message}
            hint="Terminating requires all assets to be returned"
          >
            {(p) => <EnumSelect {...p} group="employeeStatus" {...register('status')} />}
          </Field>
          <Field label="Hire date" error={errors.hireDate?.message}>
            {(p) => <Input {...p} type="date" {...register('hireDate')} />}
          </Field>
        </FormGrid>
      </form>
    </Dialog>
  );
}
