import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/** Per-request metadata (request id, client IP, user agent) for activity logging. */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore {
    return storage.getStore() ?? {};
  },
};
