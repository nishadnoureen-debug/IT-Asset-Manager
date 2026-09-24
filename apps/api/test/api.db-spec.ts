import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { seedDatabase } from '../src/database/seed';
import {
  clientIp,
  createTestApp,
  createUser,
  login,
  PNG_1PX,
  SIGNATURE,
  TEST_PASSWORD,
  truncateAll,
  type Session,
} from './db/helpers';

/**
 * End-to-end API workflows against a real PostgreSQL (`itam_test`): authentication, RBAC and data scope,
 * lifecycle transactions, licences, helpdesk, audits, reports and documents.
 */
const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;

const s = {} as Record<
  'superAdmin' | 'admin' | 'tech' | 'manager' | 'employee' | 'otherEmployee' | 'auditor',
  Session
>;
const ids = {} as Record<string, string>;
const u = {} as Record<string, string>;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  app = await createTestApp();

  const [it, fin] = await Promise.all([
    prisma.department.create({ data: { code: 'IT', name: 'IT' } }),
    prisma.department.create({ data: { code: 'FIN', name: 'Finance' } }),
  ]);
  ids.deptIt = it.id;
  ids.deptFin = fin.id;
  const hq = await prisma.location.create({ data: { code: 'HQ', name: 'HQ', type: 'SITE' } });
  const store = await prisma.location.create({
    data: { code: 'STORE', name: 'Store room', type: 'WAREHOUSE', parentId: hq.id },
  });
  ids.hq = hq.id;
  ids.store = store.id;

  const mk = (n: string, deptId: string) =>
    prisma.employee.create({
      data: {
        employeeNumber: n,
        firstName: n,
        lastName: 'Test',
        email: `${n.toLowerCase()}@example.com`,
        departmentId: deptId,
        locationId: hq.id,
      },
    });
  const [techEmp, managerEmp, alice, bob] = [
    await mk('T1', it.id),
    await mk('M1', fin.id),
    await mk('A1', fin.id),
    await mk('B1', it.id),
  ];
  ids.techEmp = techEmp.id;
  ids.managerEmp = managerEmp.id;
  ids.alice = alice.id;
  ids.bob = bob.id;

  u.superAdmin = (await createUser(prisma, 'root@example.com', ROLES.SUPER_ADMIN)).id;
  u.admin = (await createUser(prisma, 'admin@example.com', ROLES.IT_ADMINISTRATOR)).id;
  u.tech = (await createUser(prisma, 'tech@example.com', ROLES.IT_TECHNICIAN, techEmp.id)).id;
  u.manager = (
    await createUser(prisma, 'manager@example.com', ROLES.DEPARTMENT_MANAGER, managerEmp.id)
  ).id;
  u.employee = (await createUser(prisma, 'alice@example.com', ROLES.EMPLOYEE, alice.id)).id;
  u.otherEmployee = (await createUser(prisma, 'bob@example.com', ROLES.EMPLOYEE, bob.id)).id;
  u.auditor = (await createUser(prisma, 'auditor@example.com', ROLES.AUDITOR)).id;

  s.superAdmin = await login(app, 'root@example.com');
  s.admin = await login(app, 'admin@example.com');
  s.tech = await login(app, 'tech@example.com');
  s.manager = await login(app, 'manager@example.com');
  s.employee = await login(app, 'alice@example.com');
  s.otherEmployee = await login(app, 'bob@example.com');
  s.auditor = await login(app, 'auditor@example.com');

  ids.laptopType = (await prisma.assetType.findUniqueOrThrow({ where: { name: 'Laptop' } })).id;
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

async function createAsset(session: Session, extra: Record<string, unknown> = {}) {
  const res = await http()
    .post(api('/assets'))
    .set(session.auth)
    .send({ name: 'Latitude 7440', assetTypeId: ids.laptopType, locationId: ids.store, ...extra });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; assetTag: string; status: string };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('authentication', () => {
  it('logs in, sets an httpOnly refresh cookie and returns the profile with permissions', async () => {
    const res = await http()
      .post(api('/auth/login'))
      .set('X-Forwarded-For', clientIp())
      .send({ email: 'ALICE@example.com', password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.data.user.roles).toEqual([ROLES.EMPLOYEE]);
    expect(res.body.data.user.permissions).toContain('asset.view_own');
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'])
      .find((c) => c.startsWith('itam_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const me = await http()
      .get(api('/auth/me'))
      .set({ Authorization: `Bearer ${res.body.data.accessToken}` })
      .expect(200);
    expect(me.body.data.email).toBe('alice@example.com');
  });

  it('rejects bad credentials and locks the account after repeated failures', async () => {
    await createUser(prisma, 'lockme@example.com', ROLES.EMPLOYEE);
    const ip = clientIp();
    for (let i = 0; i < 5; i++) {
      const res = await http()
        .post(api('/auth/login'))
        .set('X-Forwarded-For', ip)
        .send({ email: 'lockme@example.com', password: 'wrong-password-1' });
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await http()
      .post(api('/auth/login'))
      .set('X-Forwarded-For', ip)
      .send({ email: 'lockme@example.com', password: TEST_PASSWORD })
      .expect(401);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(
      await prisma.activityLog.count({ where: { action: 'auth.login_failed' } }),
    ).toBeGreaterThanOrEqual(5);
  });

  it('rotates refresh tokens and revokes the session family when a rotated token is replayed', async () => {
    const session = await login(app, 'tech@example.com');
    const first = await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(200);
    const rotatedCookie = ([] as string[])
      .concat(first.headers['set-cookie'])
      .find((c) => c.startsWith('itam_rt='))!
      .split(';')[0];
    expect(rotatedCookie).not.toBe(session.cookie);

    // Replay of the old token outside the grace window → whole family revoked.
    const oldHash = CryptoService.sha256(decodeURIComponent(session.cookie.split('=')[1]));
    await prisma.refreshToken.update({
      where: { tokenHash: oldHash },
      data: { replacedAt: new Date(Date.now() - 120_000) },
    });
    await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(401);
    await http().post(api('/auth/refresh')).set('Cookie', rotatedCookie).expect(401);
    expect(
      await prisma.activityLog.count({ where: { action: 'auth.refresh_reuse_detected' } }),
    ).toBe(1);
  });

  it('treats a parallel refresh as a race: no family revocation and cookies are kept', async () => {
    const session = await login(app, 'manager@example.com');
    await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(200);
    // The same (just-rotated) token again, as a second tab would send it.
    const race = await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(401);
    expect(race.body.error.code).toBe('REFRESH_RACE');
    const cleared = ([] as string[]).concat(race.headers['set-cookie'] ?? []);
    expect(cleared.some((c) => c.startsWith('itam_rt=;'))).toBe(false);
    expect(
      await prisma.activityLog.count({
        where: { action: 'auth.refresh_reuse_detected', actorId: u.manager },
      }),
    ).toBe(0);
  });

  it('sets a non-secret session hint cookie next to the httpOnly refresh cookie', async () => {
    const res = await http()
      .post(api('/auth/login'))
      .set('X-Forwarded-For', clientIp())
      .send({ email: 'bob@example.com', password: TEST_PASSWORD })
      .expect(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie']);
    const hint = cookies.find((c) => c.startsWith('itam_session='))!;
    expect(hint).toMatch(/Path=\//);
    expect(hint).not.toMatch(/HttpOnly/i);
    const logout = await http()
      .post(api('/auth/logout'))
      .set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '))
      .expect(200);
    expect(
      ([] as string[])
        .concat(logout.headers['set-cookie'])
        .some((c) => c.startsWith('itam_session=;')),
    ).toBe(true);
  });

  it('logout revokes the refresh token', async () => {
    const session = await login(app, 'auditor@example.com');
    await http().post(api('/auth/logout')).set('Cookie', session.cookie).expect(200);
    await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(401);
  });

  it('resets a password with a single-use token and revokes existing sessions', async () => {
    const user = await createUser(prisma, 'reset@example.com', ROLES.EMPLOYEE);
    const session = await login(app, 'reset@example.com');
    await http()
      .post(api('/auth/forgot-password'))
      .send({ email: 'unknown@example.com' })
      .expect(200);
    const raw = 'a-very-long-test-reset-token-value-0123456789';
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: CryptoService.sha256(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const weak = await http()
      .post(api('/auth/reset-password'))
      .send({ token: raw, password: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    await http()
      .post(api('/auth/reset-password'))
      .send({ token: raw, password: 'New-password-2026' })
      .expect(200);
    await http()
      .post(api('/auth/reset-password'))
      .send({ token: raw, password: 'Another-pass-2026' })
      .expect(401);
    await http().post(api('/auth/refresh')).set('Cookie', session.cookie).expect(401);
    await login(app, 'reset@example.com', 'New-password-2026');
  });

  it('blocks disabled users immediately', async () => {
    const user = await createUser(prisma, 'temp@example.com', ROLES.IT_TECHNICIAN);
    const session = await login(app, 'temp@example.com');
    await http().get(api('/assets')).set(session.auth).expect(200);
    await http()
      .post(api(`/users/${user.id}/disable`))
      .set(s.admin.auth)
      .expect(200);
    const res = await http().get(api('/assets')).set(session.auth).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects tampered tokens', async () => {
    const tampered = s.admin.token.slice(0, -4) + 'abcd';
    await http()
      .get(api('/assets'))
      .set({ Authorization: `Bearer ${tampered}` })
      .expect(401);
  });
});

describe('authorization and data scope', () => {
  it('enforces permissions in the backend', async () => {
    await http().get(api('/users')).set(s.employee.auth).expect(403);
    await http()
      .post(api('/assets'))
      .set(s.employee.auth)
      .send({ name: 'x', assetTypeId: ids.laptopType })
      .expect(403);
    await http().get(api('/activity-logs')).set(s.admin.auth).expect(403);
    await http().get(api('/activity-logs')).set(s.superAdmin.auth).expect(200);
  });

  it('prevents privilege escalation by IT administrators', async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
    const res = await http()
      .post(api('/users'))
      .set(s.admin.auth)
      .send({
        email: 'evil@example.com',
        displayName: 'Evil',
        password: 'Password-99999',
        roleIds: [superRole.id],
      })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.EMPLOYEE } });
    await http()
      .put(api(`/roles/${employeeRole.id}/permissions`))
      .set(s.admin.auth)
      .send({ permissionKeys: ['user.create'] })
      .expect(403);
  });

  it('scopes assets to own / department and hides out-of-scope records (IDOR)', async () => {
    const aliceAsset = await createAsset(s.admin, { departmentId: ids.deptFin });
    const bobAsset = await createAsset(s.admin, { departmentId: ids.deptIt });
    await http()
      .post(api(`/assets/${aliceAsset.id}/assign`))
      .set(s.admin.auth)
      .send({ employeeId: ids.alice, condition: 'GOOD' })
      .expect(201);
    await http()
      .post(api(`/assets/${bobAsset.id}/assign`))
      .set(s.admin.auth)
      .send({ employeeId: ids.bob, condition: 'GOOD' })
      .expect(201);

    const own = await http().get(api('/assets')).set(s.employee.auth).expect(200);
    expect(own.body.data.map((a: { id: string }) => a.id)).toEqual([aliceAsset.id]);
    await http()
      .get(api(`/assets/${bobAsset.id}`))
      .set(s.employee.auth)
      .expect(404);
    await http()
      .get(api(`/assets/${bobAsset.id}/history`))
      .set(s.employee.auth)
      .expect(404);

    const dept = await http().get(api('/assets')).set(s.manager.auth).expect(200);
    const deptIds = dept.body.data.map((a: { id: string }) => a.id);
    expect(deptIds).toContain(aliceAsset.id);
    expect(deptIds).not.toContain(bobAsset.id);

    const scan = await http()
      .post(api('/qr/scan'))
      .set(s.otherEmployee.auth)
      .send({ code: aliceAsset.assetTag })
      .expect(404);
    expect(scan.body.success).toBe(false);
    ids.aliceAsset = aliceAsset.id;
  });

  it('lets auditors read inventory but not change it', async () => {
    await http().get(api('/assets')).set(s.auditor.auth).expect(200);
    const asset = await createAsset(s.admin);
    await http()
      .post(api(`/assets/${asset.id}/assign`))
      .set(s.auditor.auth)
      .send({ employeeId: ids.alice, condition: 'GOOD' })
      .expect(403);
    await http()
      .patch(api(`/assets/${asset.id}`))
      .set(s.auditor.auth)
      .send({ name: 'Renamed' })
      .expect(403);
  });
});

describe('asset lifecycle', () => {
  let asset: { id: string; assetTag: string };
  let chargerId: string;

  beforeAll(async () => {
    asset = await createAsset(s.tech, { serialNumber: 'SN-LIFECYCLE-1', purchaseCost: 1450.5 });
    const charger = await http()
      .post(api('/accessories'))
      .set(s.admin.auth)
      .send({ name: 'USB-C charger', category: 'CHARGER', quantityTotal: 5, unitCost: 95 })
      .expect(201);
    chargerId = charger.body.data.id;
    // Priced records without a currency get the default (UAE dirhams).
    expect(charger.body.data.currency).toBe('AED');
  });

  it('generates tags, records history and activity, and validates input', async () => {
    expect(asset.assetTag).toMatch(/^AST-\d{6}$/);
    const history = await http()
      .get(api(`/assets/${asset.id}/history`))
      .set(s.tech.auth)
      .expect(200);
    expect(history.body.data[0].action).toBe('CREATED');
    expect(
      await prisma.activityLog.count({ where: { action: 'asset.create', entityId: asset.id } }),
    ).toBe(1);
    const detail = await http()
      .get(api(`/assets/${asset.id}`))
      .set(s.tech.auth)
      .expect(200);
    expect(detail.body.data.currency).toBe('AED');
    expect(detail.body.data.allowedActions).toEqual(
      expect.arrayContaining(['view', 'edit', 'assign', 'maintenance']),
    );

    const unknown = await http()
      .post(api('/assets'))
      .set(s.tech.auth)
      .send({ name: 'x', assetTypeId: ids.laptopType, hacker: true })
      .expect(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    const duplicate = await http()
      .post(api('/assets'))
      .set(s.tech.auth)
      .send({ name: 'x', assetTypeId: ids.laptopType, serialNumber: 'SN-LIFECYCLE-1' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    await http()
      .patch(api(`/assets/${asset.id}`))
      .set(s.admin.auth)
      .send({ status: 'ASSIGNED' })
      .expect(400);
  });

  it('assigns transactionally with accessories, signature, PDF and notification', async () => {
    const bad = await http()
      .post(api(`/assets/${asset.id}/assign`))
      .set(s.tech.auth)
      .send({ employeeId: ids.alice, condition: 'NEW', signature: 'data:image/png;base64,AAAA' })
      .expect(400);
    expect(bad.body.error.details[0].field).toBe('signature');

    const res = await http()
      .post(api(`/assets/${asset.id}/assign`))
      .set(s.tech.auth)
      .send({
        employeeId: ids.alice,
        condition: 'NEW',
        accessories: [{ accessoryId: chargerId, quantity: 2 }],
      })
      .expect(201);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.accessoryAssignments).toHaveLength(1);
    expect(res.body.data.documents.map((d: { type: string }) => d.type)).toEqual(['HANDOVER_FORM']);

    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.status).toBe('ASSIGNED');
    expect(
      (await prisma.accessory.findUniqueOrThrow({ where: { id: chargerId } })).quantityAvailable,
    ).toBe(3);
    expect(
      await prisma.notification.count({
        where: { userId: u.employee, type: 'ASSIGNMENT_ACKNOWLEDGEMENT' },
      }),
    ).toBeGreaterThan(0);

    const again = await http()
      .post(api(`/assets/${asset.id}/assign`))
      .set(s.tech.auth)
      .send({ employeeId: ids.bob, condition: 'NEW' })
      .expect(422);
    expect(again.body.error.code).toBe('INVALID_STATE');

    const pdf = res.body.data.documents[0];
    const download = await http()
      .get(api(`/documents/${pdf.id}/download`))
      .set(s.employee.auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((download.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await http()
      .get(api(`/documents/${pdf.id}/download`))
      .set(s.otherEmployee.auth)
      .expect(404);
  });

  it('lets the assignee acknowledge with a signature', async () => {
    const assignment = await prisma.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, status: 'ACTIVE' },
    });
    // Someone else's assignment is invisible (404), never merely forbidden.
    await http()
      .post(api(`/assignments/${assignment.id}/acknowledge`))
      .set(s.otherEmployee.auth)
      .send({})
      .expect(404);
    const res = await http()
      .post(api(`/assignments/${assignment.id}/acknowledge`))
      .set(s.employee.auth)
      .send({ signature: SIGNATURE })
      .expect(200);
    expect(res.body.data.acknowledgedAt).toBeTruthy();
    expect(res.body.data.documents.map((d: { type: string }) => d.type)).toEqual(
      expect.arrayContaining(['SIGNATURE']),
    );
  });

  it('transfers: closes the old assignment, opens a linked one and moves accessories', async () => {
    const res = await http()
      .post(api(`/assets/${asset.id}/transfer`))
      .set(s.tech.auth)
      .send({ employeeId: ids.bob, reason: 'Team change', condition: 'GOOD', signature: SIGNATURE })
      .expect(200);
    expect(res.body.data.previousAssignment.status).toBe('TRANSFERRED');
    expect(res.body.data.acknowledgedAt).toBeTruthy();
    const all = await prisma.assetAssignment.findMany({
      where: { assetId: asset.id },
      orderBy: { assignedAt: 'asc' },
    });
    expect(all.map((a) => a.status)).toEqual(['TRANSFERRED', 'ACTIVE']);
    expect(all[1].previousAssignmentId).toBe(all[0].id);
    const bobAccessories = await prisma.accessoryAssignment.findMany({
      where: { employeeId: ids.bob, status: 'ACTIVE' },
    });
    expect(bobAccessories).toHaveLength(1);
    expect(
      (await prisma.accessory.findUniqueOrThrow({ where: { id: chargerId } })).quantityAvailable,
    ).toBe(3);
  });

  it('returns to repair: writes off missing accessories and opens maintenance', async () => {
    const assignment = await prisma.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, status: 'ACTIVE' },
      include: { accessoryAssignments: true },
    });
    await http()
      .post(api(`/assets/${asset.id}/return`))
      .set(s.tech.auth)
      .send({
        condition: 'DAMAGED',
        returnTo: 'IN_REPAIR',
        repairTitle: 'Cracked screen',
        accessories: [
          { accessoryAssignmentId: assignment.accessoryAssignments[0].id, returned: false },
        ],
      })
      .expect(200);
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.status).toBe('IN_REPAIR');
    expect(stored.condition).toBe('DAMAGED');
    const charger = await prisma.accessory.findUniqueOrThrow({ where: { id: chargerId } });
    expect(charger).toMatchObject({ quantityTotal: 3, quantityAvailable: 3 });
    const maintenance = await prisma.maintenance.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(maintenance).toMatchObject({ status: 'IN_PROGRESS', title: 'Cracked screen' });
    ids.maintenance = maintenance.id;
    const docs = await prisma.document.findMany({
      where: { assignmentId: assignment.id, deletedAt: null },
    });
    expect(docs.map((d) => d.type)).toEqual(expect.arrayContaining(['RETURN_FORM']));
  });

  it('completes maintenance, totals costs and makes the asset available', async () => {
    await http()
      .post(api(`/maintenance/${ids.maintenance}/complete`))
      .set(s.employee.auth)
      .send({ resolutionNotes: 'x' })
      .expect(403);
    const res = await http()
      .post(api(`/maintenance/${ids.maintenance}/complete`))
      .set(s.tech.auth)
      .send({
        laborCost: 80,
        partsCost: 120.25,
        resolutionNotes: 'Replaced display panel',
        condition: 'GOOD',
      })
      .expect(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(Number(res.body.data.totalCost)).toBe(200.25);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe(
      'AVAILABLE',
    );
  });

  it('scans a QR payload and returns role-appropriate actions', async () => {
    const qr = await http()
      .get(api(`/assets/${asset.id}/qr`))
      .set(s.tech.auth)
      .expect(200);
    expect(qr.body.data.dataUrl).toMatch(/^data:image\/png;base64,/);
    const byUrl = await http()
      .post(api('/qr/scan'))
      .set(s.tech.auth)
      .send({ code: qr.body.data.payload })
      .expect(200);
    expect(byUrl.body.data.asset.id).toBe(asset.id);
    expect(byUrl.body.data.allowedActions).toEqual(
      expect.arrayContaining(['assign', 'maintenance']),
    );
    expect(byUrl.body.data.allowedActions).not.toContain('retire');
    const byTag = await http()
      .post(api('/qr/scan'))
      .set(s.admin.auth)
      .send({ code: asset.assetTag.toLowerCase() })
      .expect(200);
    expect(byTag.body.data.allowedActions).toContain('retire');

    await http()
      .post(api(`/assets/${asset.id}/qr/regenerate`))
      .set(s.tech.auth)
      .expect(200);
    await http()
      .post(api('/qr/scan'))
      .set(s.tech.auth)
      .send({ code: qr.body.data.payload })
      .expect(404);
  });

  it('retires then disposes, after which the asset is read-only', async () => {
    await http()
      .post(api(`/assets/${asset.id}/dispose`))
      .set(s.admin.auth)
      .send({ method: 'Recycling', reason: 'Broken' })
      .expect(422);
    await http()
      .post(api(`/assets/${asset.id}/retire`))
      .set(s.admin.auth)
      .send({ reason: 'End of life' })
      .expect(200);
    const disposed = await http()
      .post(api(`/assets/${asset.id}/dispose`))
      .set(s.admin.auth)
      .send({ method: 'Certified recycling', reason: 'End of life' })
      .expect(200);
    expect(disposed.body.data.status).toBe('DISPOSED');
    await http()
      .patch(api(`/assets/${asset.id}`))
      .set(s.admin.auth)
      .send({ name: 'Nope' })
      .expect(422);
    const actions = (
      await prisma.assetHistory.findMany({
        where: { assetId: asset.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((h) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CREATED',
        'ASSIGNED',
        'TRANSFERRED',
        'RETURNED',
        'MAINTENANCE_STARTED',
        'MAINTENANCE_COMPLETED',
        'QR_REGENERATED',
        'RETIRED',
        'DISPOSED',
      ]),
    );
  });

  it('lets only one of two concurrent assignments win', async () => {
    const target = await createAsset(s.admin);
    const results = await Promise.all([
      http()
        .post(api(`/assets/${target.id}/assign`))
        .set(s.admin.auth)
        .send({ employeeId: ids.alice, condition: 'NEW' }),
      http()
        .post(api(`/assets/${target.id}/assign`))
        .set(s.admin.auth)
        .send({ employeeId: ids.bob, condition: 'NEW' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, expect.any(Number)].sort());
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      await prisma.assetAssignment.count({ where: { assetId: target.id, status: 'ACTIVE' } }),
    ).toBe(1);
  });

  it('lets an employee report their own asset lost and alerts IT', async () => {
    const lost = await createAsset(s.admin);
    await http()
      .post(api(`/assets/${lost.id}/assign`))
      .set(s.admin.auth)
      .send({ employeeId: ids.alice, condition: 'GOOD' })
      .expect(201);
    await http()
      .post(api(`/assets/${lost.id}/report-lost`))
      .set(s.otherEmployee.auth)
      .send({ notes: 'Not mine' })
      .expect(404);
    const res = await http()
      .post(api(`/assets/${lost.id}/report-lost`))
      .set(s.employee.auth)
      .send({ notes: 'Left in a taxi' })
      .expect(200);
    expect(res.body.data.asset.status).toBe('LOST');
    expect(
      await prisma.activityLog.count({ where: { action: 'asset.report_lost', entityId: lost.id } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: u.admin, entityId: lost.id } }),
    ).toBeGreaterThan(0);
  });
});

describe('software licences', () => {
  it('prevents over-allocation unless explicitly allowed, and protects licence keys', async () => {
    const software = await http()
      .post(api('/software'))
      .set(s.admin.auth)
      .send({ name: 'Acrobat Pro', version: '2024' })
      .expect(201);
    const license = await http()
      .post(api('/licenses'))
      .set(s.admin.auth)
      .send({
        softwareId: software.body.data.id,
        licenseType: 'SUBSCRIPTION',
        seats: 1,
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
      })
      .expect(201);
    const id = license.body.data.id;
    expect(license.body.data.licenseKeyMasked).toBe('••••MNOP');
    expect(JSON.stringify(license.body)).not.toContain('ABCD-EFGH');
    const row = await prisma.softwareLicense.findUniqueOrThrow({ where: { id } });
    expect(row.licenseKeyEncrypted).not.toContain('ABCD');

    await http()
      .post(api(`/licenses/${id}/assign`))
      .set(s.tech.auth)
      .send({ employeeId: ids.alice })
      .expect(201);
    const full = await http()
      .post(api(`/licenses/${id}/assign`))
      .set(s.tech.auth)
      .send({ employeeId: ids.bob })
      .expect(409);
    expect(full.body.error.code).toBe('LICENSE_SEATS_EXHAUSTED');

    await http()
      .patch(api(`/licenses/${id}`))
      .set(s.admin.auth)
      .send({ allowOverAllocation: true })
      .expect(200);
    await http()
      .post(api(`/licenses/${id}/assign`))
      .set(s.tech.auth)
      .send({ employeeId: ids.bob })
      .expect(201);

    await http()
      .get(api(`/licenses/${id}?reveal=true`))
      .set(s.tech.auth)
      .expect(403);
    const revealed = await http()
      .get(api(`/licenses/${id}?reveal=true`))
      .set(s.admin.auth)
      .expect(200);
    expect(revealed.body.data.licenseKey).toBe('ABCD-EFGH-IJKL-MNOP');
    expect(
      await prisma.activityLog.count({ where: { action: 'license.reveal_key', entityId: id } }),
    ).toBe(1);
  });
});

describe('asset requests', () => {
  it('runs request -> approve -> fulfil, with a signed-off form and scope checks', async () => {
    const laptopType = await prisma.assetType.findUniqueOrThrow({ where: { name: 'Laptop' } });
    const created = await http()
      .post(api('/requests'))
      .set(s.employee.auth)
      .send({
        title: 'Laptop for site work',
        justification: 'Current laptop cannot run the site survey software.',
        assetTypeId: laptopType.id,
        priority: 'HIGH',
      })
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('SUBMITTED');
    expect(created.body.data.employee.id).toBe(ids.alice);
    // The printable form is generated with the request.
    expect(created.body.data.documents.map((d: { type: string }) => d.type)).toEqual([
      'REQUEST_FORM',
    ]);

    // Another employee cannot see it, and cannot approve it.
    await http()
      .get(api(`/requests/${id}`))
      .set(s.otherEmployee.auth)
      .expect(404);
    await http()
      .post(api(`/requests/${id}/approve`))
      .set(s.employee.auth)
      .send({})
      .expect(403);

    const approved = await http()
      .post(api(`/requests/${id}/approve`))
      .set(s.admin.auth)
      .send({ notes: 'Approved, issue from stock' })
      .expect(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.decisionBy.id).toBe(u.admin);
    // Deciding twice is refused.
    await http()
      .post(api(`/requests/${id}/reject`))
      .set(s.admin.auth)
      .send({ notes: 'Changed my mind' })
      .expect(422);

    const asset = await createAsset(s.admin);
    const mouse = await http()
      .post(api('/accessories'))
      .set(s.admin.auth)
      .send({ name: 'Wireless mouse', category: 'MOUSE', quantityTotal: 4 })
      .expect(201);
    const fulfilled = await http()
      .post(api(`/requests/${id}/fulfil`))
      .set(s.tech.auth)
      .send({
        assetId: asset.id,
        condition: 'NEW',
        accessories: [{ accessoryId: mouse.body.data.id, quantity: 2 }],
      })
      .expect(200);
    expect(fulfilled.body.data.status).toBe('FULFILLED');
    expect(fulfilled.body.data.asset.assetTag).toBe(asset.assetTag);

    // Fulfilling hands the asset over: it is assigned, stock drops and a handover form exists.
    const handed = await prisma.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, status: 'ACTIVE' },
      include: { accessoryAssignments: true, documents: true },
    });
    expect(handed.employeeId).toBe(ids.alice);
    expect(handed.conditionAtAssignment).toBe('NEW');
    expect(handed.accessoryAssignments[0].quantity).toBe(2);
    expect(handed.documents.map((d) => d.type)).toContain('HANDOVER_FORM');
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe(
      'ASSIGNED',
    );
    expect(
      (await prisma.accessory.findUniqueOrThrow({ where: { id: mouse.body.data.id } }))
        .quantityAvailable,
    ).toBe(2);
    // One current form, replaced at each decision, and the requester was told.
    const forms = fulfilled.body.data.documents.filter(
      (d: { type: string }) => d.type === 'REQUEST_FORM',
    );
    expect(forms).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: u.employee, type: 'REQUEST_UPDATE' } }),
    ).toBeGreaterThan(0);
  });

  it('lets a requester withdraw a request and an approver reject one', async () => {
    const mine = await http()
      .post(api('/requests'))
      .set(s.employee.auth)
      .send({ title: 'Docking station', justification: 'Two monitors at the desk.' })
      .expect(201);
    const cancelled = await http()
      .post(api(`/requests/${mine.body.data.id}/cancel`))
      .set(s.employee.auth)
      .send({ notes: 'No longer needed' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const other = await http()
      .post(api('/requests'))
      .set(s.employee.auth)
      .send({ title: 'Tablet', justification: 'For site photos.' })
      .expect(201);
    const rejected = await http()
      .post(api(`/requests/${other.body.data.id}/reject`))
      .set(s.admin.auth)
      .send({ notes: 'Use the site camera instead' })
      .expect(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.decisionNotes).toBe('Use the site camera instead');
    // A decided request can no longer be fulfilled.
    await http()
      .post(api(`/requests/${other.body.data.id}/fulfil`))
      .set(s.tech.auth)
      .send({})
      .expect(422);
  });
});

describe('inventory audit', () => {
  it('snapshots expected assets, records scans and flags discrepancies', async () => {
    const present = await createAsset(s.admin);
    const absent = await createAsset(s.admin);
    const elsewhere = await createAsset(s.admin, { locationId: ids.hq });

    const audit = await http()
      .post(api('/audits'))
      .set(s.auditor.auth)
      .send({ name: 'Store room check', locationId: ids.store })
      .expect(201);
    const id = audit.body.data.id;
    const started = await http()
      .post(api(`/audits/${id}/start`))
      .set(s.auditor.auth)
      .expect(200);
    expect(started.body.data.summary.PENDING).toBeGreaterThanOrEqual(2);

    const found = await http()
      .post(api(`/audits/${id}/scan`))
      .set(s.auditor.auth)
      .send({ code: present.assetTag })
      .expect(200);
    expect(found.body.data.item.result).toBe('FOUND');
    const unexpected = await http()
      .post(api(`/audits/${id}/scan`))
      .set(s.auditor.auth)
      .send({ code: elsewhere.assetTag })
      .expect(200);
    expect(unexpected.body.data.item.result).toBe('UNEXPECTED');
    const unknown = await http()
      .post(api(`/audits/${id}/scan`))
      .set(s.auditor.auth)
      .send({ code: 'NOT-A-TAG' })
      .expect(200);
    expect(unknown.body.data.recognized).toBe(false);

    await http()
      .post(api(`/audits/${id}/complete`))
      .set(s.auditor.auth)
      .expect(200);
    const discrepancies = await http()
      .get(api(`/audits/${id}/discrepancies`))
      .set(s.auditor.auth)
      .expect(200);
    const byAsset = new Map(
      discrepancies.body.data
        .filter((i: { asset: unknown }) => i.asset)
        .map((i: { asset: { id: string }; result: string }) => [i.asset.id, i.result]),
    );
    expect(byAsset.get(absent.id)).toBe('MISSING');
    expect(byAsset.get(elsewhere.id)).toBe('UNEXPECTED');
    expect(byAsset.has(present.id)).toBe(false);

    const report = await http()
      .get(api(`/reports/audit?auditId=${id}`))
      .set(s.auditor.auth)
      .expect(200);
    expect(report.body.data.rows.length).toBeGreaterThanOrEqual(3);
    await http()
      .post(api(`/audits/${id}/close`))
      .set(s.auditor.auth)
      .expect(200);
  });
});

describe('reports and documents', () => {
  const binary = (r: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    r.on('data', (c: Buffer) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  it('exports CSV/XLSX/PDF with authorization and formula-injection protection', async () => {
    await createAsset(s.admin, { name: '=HYPERLINK("http://evil")' });
    const json = await http().get(api('/reports/assets')).set(s.admin.auth).expect(200);
    expect(json.body.data.columns.length).toBeGreaterThan(5);

    await http().get(api('/reports/assets?format=csv')).set(s.manager.auth).expect(403);
    const csv = await http().get(api('/reports/assets?format=csv')).set(s.admin.auth).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const xlsx = await http()
      .get(api('/reports/maintenance?format=xlsx'))
      .set(s.admin.auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await http()
      .get(api('/reports/software?format=pdf'))
      .set(s.admin.auth)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(await prisma.activityLog.count({ where: { action: 'report.export' } })).toBe(3);

    const deptReport = await http()
      .get(api('/reports/departments'))
      .set(s.manager.auth)
      .expect(200);
    expect(deptReport.body.data.rows.map((r: { department: string }) => r.department)).toEqual([
      'Finance',
    ]);
  });

  it('validates uploads by content, not by the declared type', async () => {
    const asset = await createAsset(s.admin);
    const ok = await http()
      .post(api('/documents'))
      .set(s.tech.auth)
      .field('type', 'PHOTO')
      .field('assetId', asset.id)
      .attach('file', PNG_1PX, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    expect(ok.body.data.mimeType).toBe('image/png');

    const fake = await http()
      .post(api('/documents'))
      .set(s.tech.auth)
      .field('type', 'INVOICE')
      .field('assetId', asset.id)
      .attach('file', Buffer.from('MZ\x90\x00 not really a pdf'), {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(fake.body.error.code).toBe('VALIDATION_ERROR');

    await http()
      .post(api('/documents'))
      .set(s.employee.auth)
      .field('type', 'PHOTO')
      .field('assetId', asset.id)
      .attach('file', PNG_1PX, 'x.png')
      .expect(403);
  });

  it('serves a personal dashboard to employees and a full one to staff', async () => {
    const mine = await http().get(api('/dashboard')).set(s.employee.auth).expect(200);
    expect(mine.body.data.scope).toBe('own');
    expect(mine.body.data.mine.assets.length).toBeGreaterThan(0);
    expect(mine.body.data.maintenance).toBeNull();
    const staff = await http().get(api('/dashboard')).set(s.admin.auth).expect(200);
    expect(staff.body.data.assets.total).toBeGreaterThan(mine.body.data.assets.total);
    expect(staff.body.data.maintenance).not.toBeNull();
  });
});
