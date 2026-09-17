import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, buildUrl } from './api-client';

const base = 'http://api.test/api/v1';

function mockFetch(status: number, body: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? 'not json' : JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
}

describe('buildUrl', () => {
  it('joins paths and drops empty query values', () => {
    expect(
      buildUrl(`${base}/`, '/assets', { page: 2, search: '', status: undefined, active: true }),
    ).toBe(`${base}/assets?page=2&active=true`);
  });
});

describe('apiRequest', () => {
  it('unwraps data and pagination meta', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    const fetchImpl = mockFetch(200, { success: true, data: [{ id: 'a' }], meta });
    await expect(apiRequest('/assets', { baseUrl: base, fetchImpl })).resolves.toEqual({
      data: [{ id: 'a' }],
      meta,
      status: 200,
    });
  });

  it('throws ApiError from the error envelope', async () => {
    const fetchImpl = mockFetch(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Asset not found', requestId: 'r1', timestamp: '' },
    });
    const error = await apiRequest('/assets/x', { baseUrl: base, fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'r1' });
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    await expect(apiRequest('/health', { baseUrl: base, fetchImpl })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('rejects non-envelope responses', async () => {
    await expect(
      apiRequest('/health', { baseUrl: base, fetchImpl: mockFetch(502, undefined) }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('allows success envelopes on error statuses when requested', async () => {
    const fetchImpl = mockFetch(503, { success: true, data: { status: 'error' } });
    await expect(
      apiRequest('/health/ready', { baseUrl: base, fetchImpl, allowErrorStatus: true }),
    ).resolves.toMatchObject({
      status: 503,
      data: { status: 'error' },
    });
  });
});
