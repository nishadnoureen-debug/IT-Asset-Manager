import { ClipboardCheck, Laptop, QrCode, Signal } from 'lucide-react';
import Image from 'next/image';
import { Suspense } from 'react';

/** What the system covers, shown beside the sign-in card on a wide screen. */
const HIGHLIGHTS = [
  {
    icon: Laptop,
    title: 'Every device, its whole life',
    text: 'Purchase to disposal, in one record.',
  },
  { icon: QrCode, title: 'Hand over in seconds', text: 'Scan the label, sign, print the form.' },
  { icon: ClipboardCheck, title: 'Requests and approvals', text: 'Asked for, approved, issued.' },
  { icon: Signal, title: 'Company SIM cards', text: 'Plans, monthly charges and swaps.' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel: dark on every theme, so the light wordmark is always the right one. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-900 p-12 text-slate-100 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_15%_-10%,#1e4b6b_0%,transparent_60%),radial-gradient(40rem_30rem_at_90%_110%,#15384f_0%,transparent_55%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
        />
        <div className="relative">
          <Image
            src="/logo-dark.png"
            alt="ARC Global"
            width={640}
            height={386}
            priority
            className="h-14 w-auto"
          />
        </div>
        <div className="relative max-w-md">
          <h2 className="text-5xl font-bold tracking-tight">Zabi</h2>
          <p className="mt-3 text-lg text-slate-300">
            Everything the company owns, and who has it right now.
          </p>
          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-5 w-5 text-sky-300" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-slate-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-400">
          ARC Global Technical Services · Dubai, UAE
        </p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* The wide screen has the brand panel; narrow screens get this header instead. */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <Image
              src="/logo.png"
              alt="ARC Global"
              width={640}
              height={386}
              priority
              className="h-14 w-auto dark:hidden"
            />
            <Image
              src="/logo-dark.png"
              alt=""
              width={640}
              height={386}
              priority
              className="hidden h-14 w-auto dark:block"
            />
            <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Zabi
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Suspense>{children}</Suspense>
          </div>
          <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            Zabi · ARC Global Technical Services
          </p>
        </div>
      </main>
    </div>
  );
}
