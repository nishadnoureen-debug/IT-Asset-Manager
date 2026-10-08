import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

/**
 * What the installed app shows when a page is asked for with no network. The service worker keeps
 * this one page cached; everything else needs the server, because the records are live.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <WifiOff className="h-10 w-10 text-slate-400" aria-hidden />
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">You are offline</h1>
      <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
        ZABY TRACKER needs a connection to read the asset register. Reconnect and try again — any
        label you were about to scan will still be there.
      </p>
    </main>
  );
}
