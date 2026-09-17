import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.validation';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuse a well-formed upstream request id (e.g. from a proxy), otherwise mint one. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  const isDev = env.NODE_ENV === 'development';
  return {
    // Express 5 / path-to-regexp v8 wildcard syntax (the library default '*' logs a deprecation warning).
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      genReqId: resolveRequestId,
      // Never log credentials or tokens.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.refreshToken',
        ],
        censor: '[REDACTED]',
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      transport: isDev
        ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
        : undefined,
    },
  };
}
