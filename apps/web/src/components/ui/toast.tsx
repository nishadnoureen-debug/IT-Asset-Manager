'use client';

import clsx from 'clsx';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface ToastApi {
  success(message: string): void;
  error(error: unknown, fallback?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (error, fallback = 'Something went wrong') =>
        push('error', error instanceof ApiError || error instanceof Error ? error.message : fallback),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
              t.kind === 'success'
                ? 'border-emerald-200 bg-white text-slate-800 dark:border-emerald-900 dark:bg-slate-900 dark:text-slate-100'
                : 'border-red-200 bg-white text-slate-800 dark:border-red-900 dark:bg-slate-900 dark:text-slate-100',
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
            )}
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
