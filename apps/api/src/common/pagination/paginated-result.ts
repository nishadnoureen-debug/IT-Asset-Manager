import type { PaginationMeta } from '@itam/shared';

/**
 * Return this from list handlers; the envelope interceptor emits `{ success, data, meta }`.
 */
export class PaginatedResult<T> {
  readonly meta: PaginationMeta;

  constructor(
    readonly items: T[],
    total: number,
    page: number,
    limit: number,
  ) {
    this.meta = { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
  }
}
