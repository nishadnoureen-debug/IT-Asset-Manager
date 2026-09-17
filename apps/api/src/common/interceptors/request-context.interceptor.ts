import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { RequestContext } from '../context/request-context';

/** Makes request metadata available to services (activity logs) without threading it through calls. */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    const store = {
      requestId: typeof req.id === 'string' ? req.id : undefined,
      ipAddress: req.ip?.slice(0, 45),
      userAgent: req.headers['user-agent']?.slice(0, 512),
    };
    return new Observable((subscriber) =>
      RequestContext.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
