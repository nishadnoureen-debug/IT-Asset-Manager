import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';

/** BOOTSTRAP_ADMIN_EMAIL: on a new install only the owner can claim the first account. */
process.env.BOOTSTRAP_ADMIN_EMAIL = 'Owner@Example.com';

const prisma = new PrismaClient();
let app: INestApplication;
let helpers: typeof import('./db/helpers');
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;
const PASSWORD = 'Register-2026';

const registerAs = (email: string) =>
  http()
    .post(api('/auth/register'))
    .set('X-Forwarded-For', helpers.clientIp())
    .send({ email, displayName: 'Someone', password: PASSWORD });

beforeAll(async () => {
  // Imported after the variable is set so the app's configuration sees it.
  helpers = await import('./db/helpers');
  await helpers.truncateAll(prisma);
  await seedDatabase(prisma);
  app = await helpers.createTestApp();
});

afterAll(async () => {
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  await app?.close();
  await prisma.$disconnect();
});

describe('owner-only first account', () => {
  it('refuses anyone else while the system has no Super Admin', async () => {
    const res = await registerAs('stranger@example.com').expect(403);
    expect(res.body.error.code).toBe('REGISTRATION_DISABLED');
    expect(await prisma.user.count()).toBe(0);
  });

  it('lets the owner register as Super Admin and then closes registration', async () => {
    const res = await registerAs('owner@example.com').expect(201);
    expect(res.body.data.status).toBe('ACTIVE');
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
      include: { roles: { include: { role: true } } },
    });
    expect(owner.roles.map((r) => r.role.name)).toEqual([ROLES.SUPER_ADMIN]);
    await helpers.login(app, 'owner@example.com', PASSWORD);

    const reg = await http().get(api('/auth/registration')).expect(200);
    expect(reg.body.data.enabled).toBe(false);
    const late = await registerAs('stranger@example.com').expect(403);
    expect(late.body.error.code).toBe('REGISTRATION_DISABLED');
    expect(await prisma.user.count()).toBe(1);
  });
});
