'use client';

import clsx from 'clsx';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number; hidden?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="flex min-w-max gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs
          .filter((t) => !t.hidden)
          .map((tab) => {
            const active = tab.value === value;
            return (
              <button
                key={tab.value}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onChange(tab.value)}
                className={clsx(
                  '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">{tab.count}</span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
