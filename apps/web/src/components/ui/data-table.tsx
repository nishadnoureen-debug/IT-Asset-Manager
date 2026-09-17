'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@itam/shared';
import type { ApiError } from '@/lib/api-client';
import { Button } from './button';
import { EmptyState, ErrorState, Skeleton } from './states';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Server-side sort field name. */
  sort?: string;
  className?: string;
  /** Hide on small screens. */
  hideOnMobile?: boolean;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  sortBy,
  sortOrder,
  onSort,
  meta,
  onPage,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: ApiError | null;
  onRetry?: () => void;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string, order: 'asc' | 'desc') => void;
  meta?: PaginationMeta;
  onPage?: (page: number) => void;
  caption?: string;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50 dark:bg-slate-900/60">
            <tr>
              {columns.map((col) => {
                const active = col.sort && sortBy === col.sort;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={clsx(
                      'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
                      col.hideOnMobile && 'hidden md:table-cell',
                      col.className,
                    )}
                    aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sort && onSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-slate-100"
                        onClick={() => onSort(col.sort!, active && sortOrder === 'asc' ? 'desc' : 'asc')}
                      >
                        {col.header}
                        {active && (sortOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
            {loading && !rows
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td key={col.key} className={clsx('px-4 py-3', col.hideOnMobile && 'hidden md:table-cell')}>
                        <Skeleton className="h-4 w-full max-w-[10rem]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows?.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={clsx(onRowClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60', loading && 'opacity-60')}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={clsx('px-4 py-3 align-middle text-slate-700 dark:text-slate-300', col.hideOnMobile && 'hidden md:table-cell', col.className)}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState title="Nothing here yet" />)}
      {meta && onPage && meta.total > 0 && <Pagination meta={meta} onPage={onPage} />}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: PaginationMeta; onPage: (page: number) => void }) {
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
      <span>
        {from}–{to} of {meta.total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
      </div>
    </div>
  );
}
