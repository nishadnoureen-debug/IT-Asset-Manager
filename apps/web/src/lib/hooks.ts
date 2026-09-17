'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiError, type ApiResult, type Query } from './api-client';

/** GET an endpoint and return the unwrapped `data` (plus `meta` for lists). */
export function useApi<T>(
  path: string | null,
  query?: Query,
  options?: Omit<UseQueryOptions<ApiResult<T>, ApiError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ApiResult<T>, ApiError>({
    queryKey: [path, query ?? {}],
    queryFn: () => api.get<T>(path!, { query }),
    enabled: !!path && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
    ...options,
  });
}

type Method = 'post' | 'patch' | 'put' | 'delete';

/**
 * Mutation that invalidates related queries on success. `invalidate` entries are path prefixes, e.g.
 * `['/assets']` refreshes every asset query.
 */
export function useApiMutation<TBody = unknown, TResult = unknown>(
  method: Method,
  path: string | ((body: TBody) => string),
  invalidate: string[] = [],
) {
  const qc = useQueryClient();
  return useMutation<ApiResult<TResult>, ApiError, TBody>({
    mutationFn: (body) => {
      const url = typeof path === 'function' ? path(body) : path;
      return method === 'delete' ? api.delete<TResult>(url) : api[method]<TResult>(url, body);
    },
    onSuccess: () => {
      for (const prefix of invalidate) {
        void qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix),
        });
      }
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === '/dashboard' || q.queryKey[0] === '/notifications/unread-count' });
    },
  });
}

/** List filters kept in the URL so views are shareable and survive reloads. */
export function useListParams<T extends Record<string, string>>(defaults: T) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const params = useMemo(() => {
    const out = { ...defaults } as Record<string, string>;
    searchParams.forEach((value, key) => {
      out[key] = value;
    });
    return out as T & { page: string };
  }, [searchParams, defaults]);

  const set = useCallback(
    (patch: Partial<Record<keyof T | 'page', string | undefined>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === (defaults as Record<string, string>)[key]) next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, defaults],
  );

  return { params, set };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
