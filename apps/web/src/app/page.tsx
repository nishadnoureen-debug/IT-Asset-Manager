import { SystemStatus } from '@/components/system-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
          Foundation
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">IT Asset Management</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Track laptops, desktops, mobiles, network equipment and accessories through their full
          lifecycle. Sign-in, the dashboard and asset modules arrive in the next phases.
        </p>
      </header>
      <SystemStatus />
    </main>
  );
}
