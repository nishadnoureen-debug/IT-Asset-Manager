import type { ApiErrorBody, ApiResponse, PaginationMeta } from '@itam/shared';
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: ApiErrorBody): ApiError {
    return new ApiError(status, body.code, body.message, body.details, body.requestId);
  }

  /** Field-level validation messages, keyed by field path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { field?: string; errors?: string[] }[]) {
      if (d?.field && d.errors?.length) out[d.field] = d.errors[0];
    }
    return out;
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
  status: number;
}

export type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  query?: Query;
  body?: unknown;
  baseUrl?: string;
  /** Resolve with the envelope even for non-2xx statuses that still carry `success: true` data (e.g. 503 readiness). */
  allowErrorStatus?: boolean;
  fetchImpl?: typeof fetch;
  /** Skip attaching the access token / automatic refresh (used by auth endpoints). */
  anonymous?: boolean;
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

// ─── Session token handling ──────────────────────────────────────────────────

let accessToken: string | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export const session = {
  setToken(token: string | null) {
    accessToken = token;
  },
  getToken() {
    return accessToken;
  },
  /** Registered by the AuthProvider; called when a request fails with an expired token. */
  onRefresh(handler: (() => Promise<boolean>) | null) {
    refreshHandler = handler;
  },
  /** Single-flight refresh shared by every concurrent request. */
  refresh(): Promise<boolean> {
    if (!refreshHandler) return Promise.resolve(false);
    refreshInFlight ??= refreshHandler().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  },
};

async function send(path: string, options: RequestOptions, isBinary: boolean): Promise<Response> {
  const { query, body, baseUrl = API_BASE_URL, fetchImpl = fetch, headers, anonymous, allowErrorStatus: _a, ...init } = options;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const token = anonymous ? null : accessToken;
  try {
    return await fetchImpl(buildUrl(baseUrl, path, query), {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: isBinary ? '*/*' : 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server', error);
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as ApiResponse<unknown>;
    if (payload && payload.success === false) return ApiError.fromBody(response.status, payload.error);
  } catch {
    /* not JSON */
  }
  return new ApiError(response.status, 'INVALID_RESPONSE', `Unexpected response (HTTP ${response.status})`);
}

async function withRefresh(path: string, options: RequestOptions, isBinary: boolean): Promise<Response> {
  let response = await send(path, options, isBinary);
  if (response.status === 401 && !options.anonymous && refreshHandler) {
    if (await session.refresh()) response = await send(path, options, isBinary);
  }
  return response;
}

/**
 * Fetch wrapper for /api/v1: attaches the access token, refreshes it once on 401, unwraps the response
 * envelope and throws `ApiError`.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const response = await withRefresh(path, options, false);

  let payload: ApiResponse<T> | undefined;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    payload = undefined;
  }

  if (payload && payload.success === false) {
    throw ApiError.fromBody(response.status, payload.error);
  }
  if (!payload || (!response.ok && !options.allowErrorStatus)) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', `Unexpected response (HTTP ${response.status})`);
  }
  return { data: payload.data, meta: payload.meta, status: response.status };
}

/** Download a binary response (PDF/CSV/XLSX/PNG) and save it in the browser. */
export async function downloadFile(path: string, options: RequestOptions & { fileName?: string } = {}): Promise<void> {
  const response = await withRefresh(path, { ...options, method: options.method ?? 'GET' }, true);
  if (!response.ok) throw await parseError(response);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = options.fileName ?? (match ? decodeURIComponent(match[1]) : 'download');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fetch a binary resource as an object URL (e.g. to preview an uploaded image). */
export async function fetchObjectUrl(path: string): Promise<string> {
  const response = await withRefresh(path, { method: 'GET' }, true);
  if (!response.ok) throw await parseError(response);
  return URL.createObjectURL(await response.blob());
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
