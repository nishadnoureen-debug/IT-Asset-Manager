'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  href?: string;
}

/**
 * Single-series horizontal bars for magnitude across categories. One hue, no legend (the card title names
 * the series), values printed in text ink, thin rounded bars on a recessive track, per-row hover tooltip.
 * Each row is a real link/row of text, so the chart doubles as its own table view.
 */
export function BarList({
  data,
  total,
  unit = 'assets',
}: {
  data: BarDatum[];
  total?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);

  if (!data.length) return <p className="py-6 text-center text-sm text-slate-500">No data yet</p>;

  return (
    <ul className="space-y-2.5">
      {data.map((d) => {
        const pct = sum ? Math.round((d.value / sum) * 100) : 0;
        const row = (
          <div
            className="group relative"
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(d.key)}
            onBlur={() => setHover(null)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-700 dark:text-slate-300">{d.label}</span>
              <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                {d.value}
              </span>
            </div>
            {/* Track is recessive; the bar is the only coloured mark. Hit target is the whole row. */}
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
              <div
                className="h-2 rounded-full bg-blue-500 transition-[width] duration-300 group-hover:bg-blue-600 dark:bg-blue-400 dark:group-hover:bg-blue-300"
                style={{ width: `${Math.max((d.value / max) * 100, d.value ? 2 : 0)}%` }}
              />
            </div>
            {hover === d.key && (
              <div
                role="tooltip"
                className="pointer-events-none absolute -top-9 right-0 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
              >
                {d.label}: <span className="font-semibold tabular-nums">{d.value}</span> {unit} ·{' '}
                {pct}%
              </div>
            )}
          </div>
        );
        return (
          <li key={d.key}>
            {d.href ? (
              <Link
                href={d.href}
                className="block rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-blue-500"
                aria-label={`${d.label}: ${d.value} ${unit} (${pct}%)`}
              >
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}
