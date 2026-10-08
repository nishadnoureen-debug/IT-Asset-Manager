'use client';

import { Download, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Chrome, Edge and Android fire this instead of prompting by themselves; we hold on to it and hand
 * it back when the person presses Install. Safari has no equivalent — there you use Share → Add to
 * Home Screen, and this banner simply never appears.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'zaby.install-dismissed';

/** Remembering "no thanks" is a convenience; a browser that blocks storage just gets asked again. */
function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISSED, '1');
  } catch {
    // Private windows refuse; the banner reappearing next time is the whole cost.
  }
}

/**
 * Registers the service worker and offers to install the app.
 *
 * The worker is what makes the browser consider the site installable, and what puts the offline
 * page up when the network drops. Registration failing is never worth breaking a page over.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => {
    const offer = (event: Event) => {
      // Without this the browser shows its own bar instead, wherever it likes.
      event.preventDefault();
      if (!dismissedBefore()) setPrompt(event as InstallPromptEvent);
    };
    const installed = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // The browser withdrew the offer (it only honours each one once).
    } finally {
      // Either way the event is spent; a browser that still wants to offer will fire a new one.
      setPrompt(null);
      setBusy(false);
    }
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 print:hidden">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Install ZABY TRACKER
          </p>
          <p className="truncate text-xs text-slate-600 dark:text-slate-400">
            Opens in its own window, straight from your home screen.
          </p>
        </div>
        <Button size="sm" onClick={install} loading={busy} icon={<Download className="h-4 w-4" />}>
          Install
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Not now"
          onClick={() => {
            rememberDismissal();
            setPrompt(null);
          }}
          icon={<X className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}
