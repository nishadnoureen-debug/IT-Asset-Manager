'use client';

import { CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PASSWORD_POLICY } from '@itam/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import type { RegistrationOptions } from '@/lib/types';

interface FormValues {
  displayName: string;
  email: string;
  password: string;
  confirm: string;
}

interface RegisterResult {
  status: 'PENDING' | 'ACTIVE';
  message: string;
}

export default function RegisterPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [result, setResult] = useState<(RegisterResult & { email: string }) | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  useEffect(() => {
    api
      .get<RegistrationOptions>('/auth/registration', { anonymous: true })
      .then(({ data }) => setOptions(data))
      .catch(() => setOptions({ enabled: false, requiresApproval: false }));
  }, []);

  const onSubmit = handleSubmit(async ({ displayName, email, password }) => {
    try {
      const { data } = await api.post<RegisterResult>(
        '/auth/register',
        { displayName: displayName.trim(), email: email.trim(), password },
        { anonymous: true },
      );
      if (data.status === 'ACTIVE') {
        // Sign in with the details just registered; fall back to the sign-in page if that fails.
        try {
          await login(email.trim(), password);
          router.replace('/dashboard');
          return;
        } catch {
          /* show the confirmation below */
        }
      }
      setResult({ ...data, email: email.trim() });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setError('email', { type: 'taken', message: 'An account with this email already exists' });
      } else if (error instanceof ApiError) {
        const f = error.fieldErrors;
        if (f.email) setError('email', { message: 'Enter a valid email address' });
        if (f.password) setError('password', { message: PASSWORD_POLICY.description });
        if (f.displayName) setError('displayName', { message: 'Enter your name' });
        if (!Object.keys(f).length) {
          setError('root', {
            message:
              error.code === 'TOO_MANY_REQUESTS'
                ? 'Too many requests. Please wait a minute and try again.'
                : error.message,
          });
        }
      } else setError('root', { message: 'Request failed' });
    }
  });

  if (options === null) return <Spinner />;

  if (!options.enabled) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Registration is closed
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Ask your IT administrator to create an account for you.
        </p>
        <Link href="/login" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (result) {
    const active = result.status === 'ACTIVE';
    return (
      <div className="space-y-4 text-center">
        <span
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${active ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950' : 'bg-amber-50 text-amber-600 dark:bg-amber-950'}`}
        >
          {active ? <CheckCircle2 className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
        </span>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          {active ? 'Account created' : 'Request sent'}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{result.message}</p>
        <ButtonLink href={`/login?email=${encodeURIComponent(result.email)}`} className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          {options.requiresApproval ? 'Request access' : 'Create an account'}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {options.requiresApproval
            ? 'An administrator approves your request and decides what you can access.'
            : 'You are signed in as soon as your account is created. An administrator can give you more access later.'}
        </p>
      </div>
      <FormError message={errors.root?.message} />
      <Field label="Full name" required error={errors.displayName?.message}>
        {(p) => (
          <Input
            {...p}
            autoComplete="name"
            autoFocus
            {...register('displayName', {
              required: 'Enter your name',
              minLength: { value: 2, message: 'Enter your name' },
            })}
          />
        )}
      </Field>
      <Field label="Work email" required error={errors.email?.message}>
        {(p) => (
          <Input
            {...p}
            type="email"
            autoComplete="email"
            {...register('email', {
              required: 'Email is required',
              pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
            })}
          />
        )}
      </Field>
      {errors.email?.type === 'taken' && (
        <p className="-mt-2 text-sm text-slate-600 dark:text-slate-400">
          <Link
            href={`/login?email=${encodeURIComponent(watch('email').trim())}`}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Sign in with this email
          </Link>{' '}
          or{' '}
          <Link
            href="/forgot-password"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            reset your password
          </Link>
          .
        </p>
      )}
      <Field
        label="Password"
        required
        error={errors.password?.message}
        hint={PASSWORD_POLICY.description}
      >
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            {...register('password', {
              required: 'Choose a password',
              pattern: { value: PASSWORD_POLICY.pattern, message: PASSWORD_POLICY.description },
            })}
          />
        )}
      </Field>
      <Field label="Confirm password" required error={errors.confirm?.message}>
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
        {options.requiresApproval ? 'Request access' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className="text-blue-600 hover:underline dark:text-blue-400">
          Sign in
        </Link>
      </p>
    </form>
  );
}
