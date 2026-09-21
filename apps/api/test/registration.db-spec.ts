import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';
import { clientIp, createTestApp, createUser, login, truncateAll } from './db/helpers';

/** Self-service registration (instant accounts, and the optional approval mode) against a real PostgreSQL. */
const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;
const PASSWORD = 'Register-2026';

const registerAs = (email: string, displayName = 'New Person', password = PASSWORD) =>
  http()
    .post(api('/auth/register'))
    .set('X-Forwarded-For', clientIp())
    .send({ email, displayName, password });

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('self-service registration', () => {
  it('makes the first registrant the Super Admin when the system has none', async () => {
    const res = await registerAs('Owner@Example.com', 'System Owner').expect(201);
    expect(res.body.data.status).toBe('ACTIVE');
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner@example.com' },
      include: { roles: { include: { role: true } } },
    });
    expect(owner.status).toBe('ACTIVE');
    expect(owner.roles.map((r) => r.role.name)).toEqual([ROLES.SUPER_ADMIN]);
    await login(app, 'owner@example.com', PASSWORD);
    expect(
      await prisma.activityLog.count({ where: { action: 'auth.register_bootstrap_admin' } }),
    ).toBe(1);
  });

  it('lets later registrants sign in straight away with the Employee role', async () => {
    const reg = await http().get(api('/auth/registration')).expect(200);
    expect(reg.body.data).toEqual({ enabled: true, requiresApproval: false });

    const res = await registerAs('carol@example.com', 'Carol Example').expect(201);
    expect(res.body.data.status).toBe('ACTIVE');
    const carol = await prisma.user.findUniqueOrThrow({
      where: { email: 'carol@example.com' },
      include: { roles: { include: { role: true } } },
    });
    expect(carol.status).toBe('ACTIVE');
    expect(carol.employeeId).toBeNull();
    expect(carol.roles.map((r) => r.role.name)).toEqual([ROLES.EMPLOYEE]);

    const session = await login(app, 'carol@example.com', PASSWORD);
    const me = await http().get(api('/auth/me')).set(session.auth).expect(200);
    expect(me.body.data.roles).toEqual([ROLES.EMPLOYEE]);
    // Employee scope only: no access to the full inventory or to user management.
    await http().get(api('/users')).set(session.auth).expect(403);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    const notification = await prisma.notification.findFirst({
      where: { userId: owner.id, entityId: carol.id },
    });
    expect(notification?.title).toBe('New user registered');
  });

  it('tells the person when the email already has an account', async () => {
    const before = await prisma.user.count();
    const res = await registerAs('CAROL@example.com').expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.user.count()).toBe(before);
    // The existing password is untouched.
    await login(app, 'carol@example.com', PASSWORD);
  });

  it('creates pending requests that cannot sign in when approval is required', async () => {
    const owner = await login(app, 'owner@example.com', PASSWORD);
    await http()
      .patch(api('/settings'))
      .set(owner.auth)
      .send({ registrationRequiresApproval: true })
      .expect(200);
    const reg = await http().get(api('/auth/registration')).expect(200);
    expect(reg.body.data).toEqual({ enabled: true, requiresApproval: true });

    const res = await registerAs('alice@example.com', 'Alice Example').expect(201);
    expect(res.body.data.status).toBe('PENDING');
    await registerAs('bob@example.com', 'Bob Example').expect(201);
    const alice = await prisma.user.findUniqueOrThrow({
      where: { email: 'alice@example.com' },
      include: { roles: true },
    });
    expect(alice.status).toBe('PENDING');
    expect(alice.roles).toHaveLength(0);

    const denied = await http()
      .post(api('/auth/login'))
      .set('X-Forwarded-For', clientIp())
      .send({ email: 'alice@example.com', password: PASSWORD })
      .expect(401);
    expect(denied.body.error.code).toBe('ACCOUNT_PENDING');

    const ownerRow = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } });
    const notification = await prisma.notification.findFirst({
      where: { userId: ownerRow.id, entityId: alice.id },
    });
    expect(notification?.title).toBe('New account request');
  });

  it('enforces the password policy', async () => {
    const res = await registerAs('weak@example.com', 'Weak', 'short').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.findUnique({ where: { email: 'weak@example.com' } })).toBeNull();
  });

  it('lets an administrator approve a request with roles, after which the user can sign in', async () => {
    const owner = await login(app, 'owner@example.com', PASSWORD);
    const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.EMPLOYEE } });

    await http()
      .post(api(`/users/${alice.id}/enable`))
      .set(owner.auth)
      .expect(422);
    const pending = await http().get(api('/users?status=PENDING')).set(owner.auth).expect(200);
    expect(pending.body.data.map((u: { email: string }) => u.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);

    const approved = await http()
      .post(api(`/users/${alice.id}/approve`))
      .set(owner.auth)
      .send({ roleIds: [employeeRole.id] })
      .expect(200);
    expect(approved.body.data.status).toBe('ACTIVE');
    await http()
      .post(api(`/users/${alice.id}/approve`))
      .set(owner.auth)
      .send({ roleIds: [employeeRole.id] })
      .expect(422);

    const session = await login(app, 'alice@example.com', PASSWORD);
    const me = await http().get(api('/auth/me')).set(session.auth).expect(200);
    expect(me.body.data.roles).toEqual([ROLES.EMPLOYEE]);
    expect(
      await prisma.activityLog.count({ where: { action: 'user.approve', entityId: alice.id } }),
    ).toBe(1);
  });

  it('does not let ordinary users approve requests', async () => {
    const alice = await login(app, 'alice@example.com', PASSWORD);
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
    await http()
      .post(api(`/users/${bob.id}/approve`))
      .set(alice.auth)
      .send({ roleIds: [superAdmin.id] })
      .expect(403);
  });

  it('only a Super Admin can approve someone as Super Admin', async () => {
    await createUser(prisma, 'itadmin@example.com', ROLES.IT_ADMINISTRATOR);
    const itAdmin = await login(app, 'itadmin@example.com');
    const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
    await http()
      .post(api(`/users/${bob.id}/approve`))
      .set(itAdmin.auth)
      .send({ roleIds: [superAdmin.id] })
      .expect(403);
  });

  it('can be switched off in settings', async () => {
    const owner = await login(app, 'owner@example.com', PASSWORD);
    await http()
      .patch(api('/settings'))
      .set(owner.auth)
      .send({ allowSelfRegistration: false })
      .expect(200);
    const reg = await http().get(api('/auth/registration')).expect(200);
    expect(reg.body.data.enabled).toBe(false);
    const res = await registerAs('late@example.com').expect(403);
    expect(res.body.error.code).toBe('REGISTRATION_DISABLED');
    await http()
      .patch(api('/settings'))
      .set(owner.auth)
      .send({ allowSelfRegistration: true })
      .expect(200);
  });
});
