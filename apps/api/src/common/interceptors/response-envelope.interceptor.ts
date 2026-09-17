import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import type { ApiSuccess } from '@itam/shared';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { PaginatedResult } from '../pagination/paginated-result';

/** Wraps successful handler results in `{ success: true, data, meta? }`. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(
      map((result): unknown => {
        if (result instanceof StreamableFile) return result;
        if (result instanceof PaginatedResult) {
          const body: ApiSuccess<unknown[]> = {
            success: true,
            data: result.items,
            meta: result.meta,
          };
          return body;
        }
        const body: ApiSuccess<unknown> = { success: true, data: result ?? null };
        return body;
      }),
    );
  }
}
