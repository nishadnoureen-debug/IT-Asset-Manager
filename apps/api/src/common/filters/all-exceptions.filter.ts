import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiFailure } from '@itam/shared';

interface PrismaKnownError {
  name: string;
  code: string;
  meta?: Record<string, unknown>;
}

/** Prisma error codes that map to client errors rather than 500s. */
const PRISMA_ERROR_MAP: Record<string, { status: HttpStatus; code: string; message: string }> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    code: 'CONFLICT',
    message: 'A record with these unique values already exists',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    code: 'FOREIGN_KEY_CONFLICT',
    message: 'Operation violates a relation constraint',
  },
  P2025: { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Record not found' },
};

function isPrismaKnownError(error: unknown): error is PrismaKnownError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as PrismaKnownError).name === 'PrismaClientKnownRequestError' &&
    typeof (error as PrismaKnownError).code === 'string'
  );
}

function defaultCodeFor(status: number): string {
  return (HttpStatus[status] as string | undefined) ?? 'ERROR';
}

/**
 * Converts every thrown error into the standard `ApiFailure` envelope. Internal error details are
 * logged with the request id and never leaked to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = defaultCodeFor(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const obj = body as { message?: unknown; code?: unknown; details?: unknown };
        if (typeof obj.code === 'string') code = obj.code;
        if (Array.isArray(obj.message)) {
          message = 'Validation failed';
          details = obj.message;
        } else if (typeof obj.message === 'string') {
          message = obj.message;
        }
        if (obj.details !== undefined) details = obj.details;
      }
    } else if (isPrismaKnownError(exception) && PRISMA_ERROR_MAP[exception.code]) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      ({ status, code, message } = mapped);
      if (exception.code === 'P2002') details = { fields: exception.meta?.target };
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: req.id, path: req.url },
        exception instanceof Error ? exception.message : 'Unhandled exception',
      );
    }

    const payload: ApiFailure = {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId: req.id,
        path: req.url,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(status).json(payload);
  }
}
