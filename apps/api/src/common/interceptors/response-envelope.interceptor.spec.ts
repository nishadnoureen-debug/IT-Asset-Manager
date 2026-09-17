import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { PaginatedResult } from '../pagination/paginated-result';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

describe('ResponseEnvelopeInterceptor', () => {
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const handle = (value: unknown): CallHandler => ({ handle: () => of(value) });

  function run(value: unknown, skip = false) {
    const reflector = { getAllAndOverride: () => skip } as unknown as Reflector;
    return lastValueFrom(
      new ResponseEnvelopeInterceptor(reflector).intercept(context, handle(value)),
    );
  }

  it('wraps plain results', async () => {
    await expect(run({ id: 1 })).resolves.toEqual({ success: true, data: { id: 1 } });
  });

  it('normalises undefined to null', async () => {
    await expect(run(undefined)).resolves.toEqual({ success: true, data: null });
  });

  it('adds pagination meta', async () => {
    await expect(run(new PaginatedResult([1, 2], 45, 2, 20))).resolves.toEqual({
      success: true,
      data: [1, 2],
      meta: { page: 2, limit: 20, total: 45, totalPages: 3 },
    });
  });

  it('respects @SkipEnvelope', async () => {
    await expect(run('raw', true)).resolves.toBe('raw');
  });
});
