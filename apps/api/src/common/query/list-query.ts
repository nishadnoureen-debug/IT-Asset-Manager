import { BadRequestException } from '@nestjs/common';
import { PaginatedResult } from '../pagination/paginated-result';
import type { PaginationQueryDto } from '../pagination/pagination-query.dto';

/**
 * Resolve `sortBy`/`sortOrder` against a whitelist of sortable fields. Unknown fields are rejected so
 * clients cannot sort by arbitrary (possibly sensitive) columns.
 */
export function resolveOrderBy<T extends object>(
  query: Pick<PaginationQueryDto, 'sortBy' | 'sortOrder'>,
  allowed: Record<string, (order: 'asc' | 'desc') => T>,
  fallback: T,
): T {
  if (!query.sortBy) return fallback;
  const build = allowed[query.sortBy];
  if (!build) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `Cannot sort by "${query.sortBy}"`,
      details: [{ field: 'sortBy', errors: [`Allowed: ${Object.keys(allowed).join(', ')}`] }],
    });
  }
  return build(query.sortOrder ?? 'desc');
}

export async function paginate<T>(
  query: Pick<PaginationQueryDto, 'page' | 'limit' | 'skip'>,
  fetch: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<PaginatedResult<T>> {
  const [items, total] = await Promise.all([fetch({ skip: query.skip, take: query.limit }), count()]);
  return new PaginatedResult(items, total, query.page, query.limit);
}

/** Case-insensitive `contains` filter across several string columns. */
export function searchFilter(search: string | undefined, fields: string[]) {
  const term = search?.trim();
  if (!term) return undefined;
  return fields.map((field) => nestedContains(field, term));
}

function nestedContains(path: string, term: string): Record<string, unknown> {
  const parts = path.split('.');
  let clause: Record<string, unknown> = { contains: term, mode: 'insensitive' };
  for (let i = parts.length - 1; i >= 0; i--) clause = { [parts[i]]: clause };
  return clause;
}

export function startOfDay(date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function startOfMonth(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
