'use client';

import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import type { RegistrationOptions } from '@/lib/types';

interface FormValues {
  email: string;
  password: string;
}

/** Only allow same-site relative redirects after sign-in. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Unable to sign in';
  switch (error.code) {
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'NETWORK_ERROR':
    case 'INVALID_RESPONSE':
      return 'The server is not responding. Make sure the API is running and try again.';
    default:
      return error.message;
  }
}

export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [registration, setRegistration] = useState<RegistrationOptions | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: params.get('email') ?? '' } });

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, router, next]);

  useEffect(() => {
    api
      .get<RegistrationOptions>('/auth/registration', { anonymous: true })
      .then(({ data }) => setRegistration(data))
      .catch(() => setRegistration(null));
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.email.trim(), values.password);
      router.replace(next);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        const fields = error.fieldErrors;
        if (fields.email) setError('email', { message: 'Enter a valid email address' });
        if (fields.password) setError('password', { message: 'Enter your password' });
        if (fields.email || fields.password) return;
      }
      setError('root', { message: messageFor(error) });
    }
  });

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sign in to Zabi with your company account.
          </p>
        </div>
        <FormError message={errors.root?.message} />
        <Field label="Email" error={errors.email?.message} required>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="username"
              autoFocus
              {...register('email', {
                required: 'Email is required',
                pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
              })}
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
        <div className="text-right">
          <Link
            href="/forgot-password"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      {registration?.enabled && (
        <div className="relative border-t border-slate-200 pt-6 text-center dark:border-slate-800">
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white px-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-900 dark:text-slate-500">
            New here?
          </span>
          <ButtonLink
            href="/register"
            variant="secondary"
            className="w-full"
            icon={<UserPlus className="h-4 w-4" />}
          >
            {registration.requiresApproval ? 'Request access' : 'Create an account'}
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
