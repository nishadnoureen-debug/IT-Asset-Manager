'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PASSWORD_POLICY } from '@itam/shared';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api-client';

interface FormValues {
  password: string;
  confirm: string;
}

export default function ResetPasswordPage() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await api.post('/auth/reset-password', { token, password }, { anonymous: true });
      setDone(true);
    } catch (error) {
      setError('root', { message: error instanceof ApiError ? error.message : 'Reset failed' });
    }
  });

  if (!token) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Invalid link</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This reset link is incomplete. Request a new one.
        </p>
        <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Password updated
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          You can now sign in with your new password.
        </p>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
        Choose a new password
      </h1>
      <FormError message={errors.root?.message} />
      <Field
        label="New password"
        error={errors.password?.message}
        hint={PASSWORD_POLICY.description}
        required
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            {...register('password', {
              required: 'Password is required',
              pattern: { value: PASSWORD_POLICY.pattern, message: PASSWORD_POLICY.description },
            })}
          />
        )}
      </Field>
      <Field label="Confirm password" error={errors.confirm?.message} required>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            {...register('confirm', {
              validate: (v) => v === watch('password') || 'Passwords do not match',
            })}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
