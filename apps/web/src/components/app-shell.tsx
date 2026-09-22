'use client';

import clsx from 'clsx';
import { Bell, LogOut, Menu, Monitor, QrCode, UserCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@itam/shared';
import { useAuth } from '@/lib/auth';
import { setDefaultCurrency } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { NAV, SECTION_LABELS, type NavItem } from '@/lib/nav';
import { Spinner } from './ui/states';

function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = (['main', 'operations', 'admin'] as const).filter((s) =>
    items.some((i) => i.section === s),
  );
  return (
    <nav aria-label="Main" className="space-y-6">
      {sections.map((section) => (
        <div key={section}>
          <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {SECTION_LABELS[section]}
          </p>
          <ul className="mt-2 space-y-0.5">
            {items
              .filter((i) => i.section === section)
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ companyName }: { companyName?: string }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
        <Monitor className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-bold text-slate-900 dark:text-slate-50">IT Assets</span>
        {companyName && (
          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
            {companyName}
          </span>
        )}
      </span>
    </Link>
  );
}

function NotificationBell() {
  const { data } = useApi<{ unread: number }>('/notifications/unread-count', undefined, {
    refetchInterval: 60_000,
  });
  const unread = data?.data.unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) return null;
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            {user.displayName}
          </span>
          <span className="block max-w-[10rem] truncate text-xs text-slate-500">
            {user.roles.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}
          </span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="truncate border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
            {user.email}
          </p>
          <Link
            role="menuitem"
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <UserCircle2 className="h-4 w-4" aria-hidden /> My profile
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false);
              await logout();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Authenticated layout: redirects to /login when signed out, renders sidebar + top bar otherwise. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const settings = useApi<AppSettings>(status === 'authenticated' ? '/settings' : null, undefined, {
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  useEffect(() => setDrawer(false), [pathname]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner
          label={status === 'loading' ? 'Loading your workspace' : 'Redirecting to sign in'}
        />
      </div>
    );
  }

  const items = NAV.filter((item) => can(...item.anyOf));
  const companyName = settings.data?.data.companyName;
  setDefaultCurrency(settings.data?.data.defaultCurrency);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-3 py-5 dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <Brand companyName={companyName} />
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavLinks items={items} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white px-3 py-5 shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <Brand companyName={companyName} />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto">
              <NavLinks items={items} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          {can('qr.scan') && (
            <Link
              href="/scan"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Scan QR code"
            >
              <QrCode className="h-5 w-5" aria-hidden />
            </Link>
          )}
          <NotificationBell />
          <UserMenu />
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
