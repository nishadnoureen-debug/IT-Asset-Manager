'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

interface FormValues {
  email: string;
  password: string;
}

/** Only allow same-site relative redirects after sign-in. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, router, next]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email, values.password);
      router.replace(next);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.code === 'TOO_MANY_REQUESTS'
            ? 'Too many attempts. Please wait a minute and try again.'
            : error.message
          : 'Unable to sign in';
      setError('root', { message });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your company account.</p>
      </div>
      <FormError message={errors.root?.message} />
      <Field label="Email" error={errors.email?.message} required>
        {(p) => (
          <Input
            {...p}
            type="email"
            autoComplete="username"
            autoFocus
            {...register('email', { required: 'Email is required' })}
          />
        )}
      </Field>
      <Field label="Password" error={errors.password?.message} required>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="current-password"
            {...register('password', { required: 'Password is required' })}
          />
        )}
      </Field>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-blue-600 hover:underline dark:text-blue-400">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
