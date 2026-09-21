import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { REQUEST_ID_HEADER } from './common/logging/logger.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { createValidationPipe } from './common/validation/validation.factory';
import type { Env } from './config/env.validation';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts and e2e tests so both exercise the same HTTP pipeline. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  (app as NestExpressApplication).set(
    'trust proxy',
    /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
  );

  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER, 'content-disposition'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new RequestContextInterceptor(),
    new ResponseEnvelopeInterceptor(app.get(Reflector)),
  );
  app.enableShutdownHooks();

  if (config.get('ENABLE_SWAGGER', { infer: true }) && !isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('IT Asset Management API')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
}
