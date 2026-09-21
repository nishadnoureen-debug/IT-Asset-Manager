'use client';

import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { PASSWORD_POLICY } from '@itam/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { Field, FormError, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>();

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed');
      reset();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'INVALID_CREDENTIALS')
          setError('currentPassword', { message: 'Current password is incorrect' });
        else setError('root', { message: e.message });
      }
    }
  });

  if (!user) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My profile" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody>
            <DetailList
              columns={1}
              items={[
                { label: 'Name', value: user.displayName },
                { label: 'Email', value: user.email },
                {
                  label: 'Roles',
                  value: (
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((r) => (
                        <Badge key={r}>{r.replace(/_/g, ' ').toLowerCase()}</Badge>
                      ))}
                    </div>
                  ),
                },
                {
                  label: 'Employee record',
                  value: user.employee ? (
                    <Link
                      href={`/employees/${user.employee.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {user.employee.firstName} {user.employee.lastName} ·{' '}
                      {user.employee.employeeNumber}
                    </Link>
                  ) : (
                    'Not linked'
                  ),
                },
                { label: 'Department', value: user.employee?.department?.name ?? '—' },
                { label: 'Last sign-in', value: formatDateTime(user.lastLoginAt) },
                { label: 'Permissions', value: `${user.permissions.length} granted` },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <FormError message={errors.root?.message} />
              <Field label="Current password" required error={errors.currentPassword?.message}>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="current-password"
                    {...register('currentPassword', { required: 'Required' })}
                  />
                )}
              </Field>
              <Field
                label="New password"
                required
                error={errors.newPassword?.message}
                hint={PASSWORD_POLICY.description}
              >
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    {...register('newPassword', {
                      required: 'Required',
                      pattern: {
                        value: PASSWORD_POLICY.pattern,
                        message: PASSWORD_POLICY.description,
                      },
                    })}
                  />
                )}
              </Field>
              <Field label="Confirm new password" required error={errors.confirm?.message}>
                {(p) => (
                  <Input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    {...register('confirm', {
                      validate: (v) => v === watch('newPassword') || 'Passwords do not match',
                    })}
                  />
                )}
              </Field>
              <Button type="submit" loading={isSubmitting}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
