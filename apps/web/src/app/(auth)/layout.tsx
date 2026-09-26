import Image from 'next/image';
import { Suspense } from 'react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2">
        {/* The navy wordmark needs a light version on a dark page. */}
        <Image
          src="/logo.png"
          alt="ARC Global"
          width={640}
          height={386}
          priority
          className="h-16 w-auto dark:hidden"
        />
        <Image
          src="/logo-dark.png"
          alt=""
          width={640}
          height={386}
          priority
          className="hidden h-16 w-auto dark:block"
        />
        <span className="text-sm font-semibold tracking-wide text-slate-600 dark:text-slate-300">
          IT Asset Management
        </span>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
