'use client';

import { useApiHealth } from '@/hooks/use-api-health';

function Dot({ tone }: { tone: 'ok' | 'bad' | 'pending' }) {
  const color =
    tone === 'ok' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : 'bg-slate-400 animate-pulse';
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

function Row({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'ok' | 'bad' | 'pending';
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        <Dot tone={tone} />
        {value}
      </span>
    </div>
  );
}

export function SystemStatus() {
  const health = useApiHealth();

  return (
    <section
      aria-labelledby="system-status-heading"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between">
        <h2 id="system-status-heading" className="text-base font-semibold">
          System status
        </h2>
        <button
          type="button"
          onClick={() => void health.refresh()}
          disabled={health.state === 'loading'}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {health.state === 'loading' ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800" aria-live="polite">
        {health.state === 'loading' && (
          <>
            <Row label="API" tone="pending" value="Checking" />
            <Row label="Database" tone="pending" value="Checking" />
          </>
        )}
        {health.state === 'error' && (
          <>
            <Row label="API" tone="bad" value="Unreachable" />
            <p className="py-3 text-sm text-red-600 dark:text-red-400">{health.error.message}</p>
          </>
        )}
        {health.state === 'ready' && (
          <>
            <Row label={`API v${health.data.version}`} tone="ok" value="Online" />
            <Row
              label="Database"
              tone={health.data.checks.database?.status === 'up' ? 'ok' : 'bad'}
              value={health.data.checks.database?.status === 'up' ? 'Connected' : 'Unavailable'}
            />
            <Row label="Environment" tone="ok" value={health.data.environment} />
          </>
        )}
      </div>
    </section>
  );
}
