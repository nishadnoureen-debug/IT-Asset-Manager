/**
 * Consistent response envelope for every /api/v1 endpoint (spec §5).
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  path?: string;
  timestamp: string;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type SortOrder = 'asc' | 'desc';

export interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessStatus extends HealthStatus {
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
}
