'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReadinessStatus } from '@itam/shared';
import { api, ApiError } from '@/lib/api-client';

type State =
  | { state: 'loading' }
  | { state: 'ready'; data: ReadinessStatus }
  | { state: 'error'; error: ApiError };

export function useApiHealth() {
  const [result, setResult] = useState<State>({ state: 'loading' });

  const refresh = useCallback(async () => {
    setResult({ state: 'loading' });
    try {
      const { data } = await api.get<ReadinessStatus>('/health/ready', {
        allowErrorStatus: true,
        cache: 'no-store',
      });
      setResult({ state: 'ready', data });
    } catch (error) {
      setResult({
        state: 'error',
        error: error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Unexpected error'),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...result, refresh };
}
