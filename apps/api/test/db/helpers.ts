import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  // TRUNCATE bypasses the row-level append-only triggers by design (test/maintenance only).
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE asset_tag_seq RESTART WITH 1`);
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export const TEST_PASSWORD = 'Password-12345';
let cachedHash: Promise<string> | undefined;

export async function createUser(
  prisma: PrismaClient,
  email: string,
  roleName: string,
  employeeId?: string,
) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  return prisma.user.create({
    data: {
      email,
      displayName: email.split('@')[0],
      passwordHash: await (cachedHash ??= hash(TEST_PASSWORD, {
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      })),
      employeeId,
      roles: { create: { roleId: role.id } },
    },
  });
}

export interface Session {
  token: string;
  cookie: string;
  auth: { Authorization: string };
}

let ipCounter = 0;
/** A distinct client IP per call, so per-IP rate limits on auth routes don't interfere between tests. */
export function clientIp(): string {
  ipCounter++;
  return `10.1.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export async function login(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', clientIp())
    .send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('itam_rt='))!;
  return {
    token: res.body.data.accessToken,
    cookie: cookie.split(';')[0],
    auth: { Authorization: `Bearer ${res.body.data.accessToken}` },
  };
}

/** 1×1 transparent PNG. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
export const SIGNATURE = `data:image/png;base64,${PNG_1PX.toString('base64')}`;
