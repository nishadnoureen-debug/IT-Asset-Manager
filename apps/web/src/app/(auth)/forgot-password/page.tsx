'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>();

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      const { data } = await api.post<{ message: string }>(
        '/auth/forgot-password',
        { email },
        { anonymous: true },
      );
      setSent(data.message);
    } catch (error) {
      setError('root', { message: error instanceof ApiError ? error.message : 'Request failed' });
    }
  });

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Check your email
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{sent}</p>
        <Link href="/login" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Reset password</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          We will send a reset link to your email address.
        </p>
      </div>
      <FormError message={errors.root?.message} />
      <Field label="Email" error={errors.email?.message} required>
        {(p) => (
          <Input
            {...p}
            type="email"
            autoComplete="email"
            autoFocus
            {...register('email', { required: 'Email is required' })}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-blue-600 hover:underline dark:text-blue-400">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
