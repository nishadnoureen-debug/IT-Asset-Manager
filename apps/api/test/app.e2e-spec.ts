import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Public } from '../src/auth/decorators';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

class EchoDto {
  @IsString()
  @MinLength(3)
  name!: string;
}

/** Test-only route to exercise the global validation pipe end-to-end. */
@Public()
@Controller('__echo')
class EchoController {
  @Post()
  echo(@Body() dto: EchoDto) {
    return dto;
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

describe('HTTP pipeline (e2e)', () => {
  let app: INestApplication;
  const prismaMock = { $queryRaw: jest.fn(), $disconnect: jest.fn() };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql://itam:itam@localhost:5432/itam_test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule, EchoModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns the success envelope and a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', service: 'itam-api' } });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('propagates a caller-supplied request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'trace-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('GET /api/v1/health/ready is 200 when the database responds', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.checks.database.status).toBe('up');
  });

  it('GET /api/v1/health/ready is 503 when the database is down', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body.data).toMatchObject({
      status: 'error',
      checks: { database: { status: 'down' } },
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('unknown routes return the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('routes outside /api/v1 are not served', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('rejects invalid and non-whitelisted payloads with VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/__echo')
      .send({ name: 'ab', isAdmin: true })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['isAdmin', 'name']);
  });

  it('accepts valid payloads', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/__echo')
      .send({ name: 'Laptop' })
      .expect(201);
    expect(res.body).toEqual({ success: true, data: { name: 'Laptop' } });
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
