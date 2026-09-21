import { Monitor } from 'lucide-react';
import { Suspense } from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Monitor className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-lg font-bold text-slate-900 dark:text-slate-50">
          IT Asset Management
        </span>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
