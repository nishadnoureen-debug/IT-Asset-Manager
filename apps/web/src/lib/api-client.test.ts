import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, buildUrl, session } from './api-client';

const base = 'http://api.test/api/v1';

function mockFetch(status: number, body: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(body === undefined ? 'not json' : JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
}

afterEach(() => {
  session.setToken(null);
  session.onRefresh(null);
});

describe('buildUrl', () => {
  it('joins paths, drops empty query values and comma-joins arrays', () => {
    expect(
      buildUrl(`${base}/`, '/assets', {
        page: 2,
        search: '',
        status: undefined,
        active: true,
        ids: ['a', 'b'],
      }),
    ).toBe(`${base}/assets?page=2&active=true&ids=a%2Cb`);
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

  it('throws ApiError from the error envelope and exposes field errors', async () => {
    const fetchImpl = mockFetch(400, {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'name', errors: ['name is required'] }],
        requestId: 'r1',
        timestamp: '',
      },
    });
    const error = await apiRequest('/assets', { baseUrl: base, fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'r1' });
    expect(error.fieldErrors).toEqual({ name: 'name is required' });
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
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('allows success envelopes on error statuses when requested', async () => {
    const fetchImpl = mockFetch(503, { success: true, data: { status: 'error' } });
    await expect(
      apiRequest('/health/ready', { baseUrl: base, fetchImpl, allowErrorStatus: true }),
    ).resolves.toMatchObject({ status: 503, data: { status: 'error' } });
  });

  it('attaches the access token and refreshes once on 401', async () => {
    session.setToken('old-token');
    const refresh = vi.fn(async () => {
      session.setToken('new-token');
      return true;
    });
    session.onRefresh(refresh);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'TOKEN_EXPIRED', message: 'expired', timestamp: '' },
          }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 }),
      ) as unknown as typeof fetch;

    await expect(apiRequest('/assets', { baseUrl: base, fetchImpl })).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].headers.Authorization).toBe('Bearer old-token');
    expect(calls[1][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('shares a single refresh between concurrent requests', async () => {
    let resolve!: (v: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    session.onRefresh(refresh);
    const a = session.refresh();
    const b = session.refresh();
    resolve(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never sends the token on anonymous requests', async () => {
    session.setToken('secret');
    const fetchImpl = mockFetch(200, { success: true, data: null });
    await apiRequest('/auth/login', {
      baseUrl: base,
      fetchImpl,
      anonymous: true,
      method: 'POST',
      body: {},
    });
    const headers = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });
});
