import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import type { ApiError } from '@/lib/api-client';
import { Button } from './button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div
      role="status"
      className={clsx(
        'flex items-center justify-center gap-2 py-10 text-sm text-slate-500',
        className,
      )}
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)} />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400 dark:bg-slate-800">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: ApiError | Error | null | undefined;
  onRetry?: () => void;
}) {
  const code = error && 'code' in error ? (error as ApiError).code : undefined;
  const message =
    code === 'NOT_FOUND'
      ? 'This record does not exist or you do not have access to it.'
      : code === 'FORBIDDEN'
        ? 'You do not have permission to view this.'
        : (error?.message ?? 'Something went wrong.');
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-red-50 p-3 text-red-500 dark:bg-red-950">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {code === 'NOT_FOUND'
          ? 'Not found'
          : code === 'FORBIDDEN'
            ? 'Access denied'
            : 'Could not load data'}
      </p>
      <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
      {onRetry && code !== 'NOT_FOUND' && code !== 'FORBIDDEN' && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={onRetry}
        >
          Try again
        </Button>
      )}
    </div>
  );
}

/** Render loading / error / content for a query result. */
export function QueryState<T>({
  query,
  children,
  loading,
}: {
  query: { isLoading: boolean; error: ApiError | null; data?: { data: T }; refetch: () => unknown };
  children: (data: T) => React.ReactNode;
  loading?: React.ReactNode;
}) {
  if (query.isLoading) return <>{loading ?? <Spinner />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  return <>{children(query.data.data)}</>;
}
