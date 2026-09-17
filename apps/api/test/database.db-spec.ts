import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  ASSIGNMENT_STATUSES,
  ROLE_PERMISSIONS,
  ROLES,
} from '@itam/shared';
import { DEFAULT_ASSET_TYPES, seedDatabase } from '../src/database/seed';
import { truncateAll as truncateTables } from './db/helpers';

/**
 * Integration tests for the initial migration against a real PostgreSQL (`itam_test`).
 * Run with `npm run test:db` while PostgreSQL is up (`npm run db:local` or `npm run db:up`).
 */
const prisma = new PrismaClient();

const EXPECTED_TABLES = [
  'accessories',
  'accessory_assignments',
  'activity_logs',
  'asset_assignments',
  'asset_history',
  'asset_types',
  'assets',
  'audit_items',
  'audit_sessions',
  'departments',
  'documents',
  'employees',
  'locations',
  'maintenance',
  'notifications',
  'password_reset_tokens',
  'permissions',
  'purchases',
  'refresh_tokens',
  'role_permissions',
  'roles',
  'settings',
  'software',
  'software_assignments',
  'software_licenses',
  'ticket_comments',
  'tickets',
  'user_roles',
  'users',
  'vendors',
];

const truncateAll = () => truncateTables(prisma);

let seq = 0;
const uid = (prefix: string) => `${prefix}-${++seq}`;

async function createAsset(overrides: Partial<Prisma.AssetUncheckedCreateInput> = {}) {
  const type = await prisma.assetType.upsert({
    where: { name: 'Laptop' },
    create: { name: 'Laptop', category: 'LAPTOP' },
    update: {},
  });
  return prisma.asset.create({
    data: { assetTag: uid('AST'), name: 'ThinkPad T14', assetTypeId: type.id, ...overrides },
  });
}

async function createEmployee() {
  const n = uid('EMP');
  return prisma.employee.create({
    data: {
      employeeNumber: n,
      firstName: 'Test',
      lastName: n,
      email: `${n.toLowerCase()}@example.com`,
    },
  });
}

async function createLocation() {
  return prisma.location.create({ data: { code: uid('LOC'), name: 'HQ', type: 'SITE' } });
}

function expectUniqueViolation(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ code: 'P2002' });
}

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll();
});

describe('migration', () => {
  it('creates every table from spec §3 plus ticket_comments, auth tokens and settings', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('uses a UTF-8 database and round-trips non-Latin text', async () => {
    const [{ encoding }] = await prisma.$queryRaw<{ encoding: string }[]>`
      SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = current_database()`;
    expect(encoding).toBe('UTF8');
    const location = await prisma.location.create({
      data: { code: uid('LOC'), name: 'دبي — المكتب الرئيسي' },
    });
    expect((await prisma.location.findUniqueOrThrow({ where: { id: location.id } })).name).toBe(
      'دبي — المكتب الرئيسي',
    );
  });

  it('has no drift between the migrations and schema.prisma', () => {
    const cwd = join(__dirname, '..');
    // --exit-code: 0 = no difference, 2 = difference.
    expect(() =>
      execSync(
        `npx prisma migrate diff --from-url "${process.env.DATABASE_URL}" --to-schema-datamodel prisma/schema.prisma --exit-code`,
        { cwd, stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it.each([
    ['asset_status', ASSET_STATUSES],
    ['asset_category', ASSET_CATEGORIES],
    ['asset_condition', ASSET_CONDITIONS],
    ['assignment_status', ASSIGNMENT_STATUSES],
  ])('database enum %s matches @itam/shared', async (enumName, expected) => {
    const rows = await prisma.$queryRaw<{ label: string }[]>`
      SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${enumName} ORDER BY e.enumsortorder`;
    expect(rows.map((r) => r.label)).toEqual([...expected]);
  });
});

describe('seed', () => {
  it('is idempotent and gives each system role exactly its catalogue permissions', async () => {
    await seedDatabase(prisma);
    const second = await seedDatabase(prisma);

    expect(second.permissions).toBe(ALL_PERMISSIONS.length);
    expect(await prisma.permission.count()).toBe(ALL_PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(6);
    expect(await prisma.assetType.count()).toBe(DEFAULT_ASSET_TYPES.length);

    for (const name of Object.values(ROLES)) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { name },
        include: { permissions: { include: { permission: true } } },
      });
      expect(role.isSystem).toBe(true);
      expect(role.permissions.map((rp) => rp.permission.key).sort()).toEqual(
        [...ROLE_PERMISSIONS[name]].sort(),
      );
    }
  });

  it('preserves admin customisations of system roles and custom asset types across re-seeds', async () => {
    await seedDatabase(prisma);
    const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.EMPLOYEE } });
    const ticketCreate = await prisma.permission.findUniqueOrThrow({ where: { key: 'ticket.create' } });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: ticketCreate.id } },
    });
    await prisma.assetType.update({ where: { name: 'Laptop' }, data: { depreciationMonths: 48 } });

    await seedDatabase(prisma);

    expect(
      await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: ticketCreate.id } },
      }),
    ).toBeNull();
    expect(
      (await prisma.assetType.findUniqueOrThrow({ where: { name: 'Laptop' } })).depreciationMonths,
    ).toBe(48);
  });

  it('grants permissions newly added to the catalogue to existing system roles', async () => {
    await seedDatabase(prisma);
    await prisma.permission.delete({ where: { key: 'ticket.assign' } }); // simulate an older catalogue
    const summary = await seedDatabase(prisma);
    expect(summary.newPermissions).toBe(1);
    const tech = await prisma.role.findUniqueOrThrow({
      where: { name: ROLES.IT_TECHNICIAN },
      include: { permissions: { include: { permission: true } } },
    });
    expect(tech.permissions.map((p) => p.permission.key)).toContain('ticket.assign');
  });

  it('never grants Super-Admin-only permissions to other roles', () => {
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === ROLES.SUPER_ADMIN) continue;
      expect(keys).not.toContain('role.manage');
      expect(keys).not.toContain('settings.edit');
      expect(keys).not.toContain('activity_log.view');
    }
  });
});

describe('asset assignments', () => {
  it('allows only one ACTIVE assignment per asset but preserves history', async () => {
    const asset = await createAsset();
    const [alice, bob] = [await createEmployee(), await createEmployee()];

    const first = await prisma.assetAssignment.create({
      data: { assetId: asset.id, employeeId: alice.id, conditionAtAssignment: 'NEW' },
    });
    await expectUniqueViolation(
      prisma.assetAssignment.create({
        data: { assetId: asset.id, employeeId: bob.id, conditionAtAssignment: 'NEW' },
      }),
    );

    // Transfer: close the old assignment, open a new one linked to it — in one transaction.
    await prisma.$transaction([
      prisma.assetAssignment.update({
        where: { id: first.id },
        data: { status: 'TRANSFERRED', returnedAt: new Date() },
      }),
      prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          employeeId: bob.id,
          conditionAtAssignment: 'GOOD',
          previousAssignmentId: first.id,
          transferReason: 'Role change',
        },
      }),
    ]);

    const history = await prisma.assetAssignment.findMany({ where: { assetId: asset.id } });
    expect(history.map((a) => a.status).sort()).toEqual(['ACTIVE', 'TRANSFERRED']);
  });

  it('requires an employee or a location', async () => {
    const asset = await createAsset();
    await expect(
      prisma.assetAssignment.create({ data: { assetId: asset.id, conditionAtAssignment: 'NEW' } }),
    ).rejects.toThrow(/asset_assignments_assignee_required/);

    const location = await createLocation();
    await expect(
      prisma.assetAssignment.create({
        data: { assetId: asset.id, locationId: location.id, conditionAtAssignment: 'NEW' },
      }),
    ).resolves.toBeDefined();
  });

  it('keeps status and returned_at consistent', async () => {
    const asset = await createAsset();
    const employee = await createEmployee();
    await expect(
      prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          employeeId: employee.id,
          conditionAtAssignment: 'NEW',
          status: 'RETURNED',
        },
      }),
    ).rejects.toThrow(/asset_assignments_returned_consistency/);
  });

  it('blocks hard-deleting an asset that has assignment history', async () => {
    const asset = await createAsset();
    const employee = await createEmployee();
    await prisma.assetAssignment.create({
      data: { assetId: asset.id, employeeId: employee.id, conditionAtAssignment: 'NEW' },
    });
    await expect(prisma.asset.delete({ where: { id: asset.id } })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });
});

describe('assets', () => {
  it('enforces unique asset tags, serial numbers and QR tokens (multiple NULL serials allowed)', async () => {
    const a = await createAsset({ serialNumber: 'SN-1' });
    await expectUniqueViolation(createAsset({ assetTag: a.assetTag }));
    await expectUniqueViolation(createAsset({ serialNumber: 'SN-1' }));
    await expectUniqueViolation(createAsset({ qrToken: a.qrToken }));
    await createAsset();
    await createAsset();
    expect(a.qrToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.status).toBe('REGISTERED');
  });

  it('validates currency and warranty dates', async () => {
    await expect(createAsset({ currency: 'usd' })).rejects.toThrow(/assets_currency_iso/);
    await expect(
      createAsset({
        warrantyStartDate: new Date('2026-01-01'),
        warrantyEndDate: new Date('2025-01-01'),
      }),
    ).rejects.toThrow(/assets_warranty_dates/);
    await expect(createAsset({ purchaseCost: -1 })).rejects.toThrow(
      /assets_purchase_cost_non_negative/,
    );
  });

  it('restricts deleting an asset type that is in use', async () => {
    const asset = await createAsset();
    await expect(
      prisma.assetType.delete({ where: { id: asset.assetTypeId } }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});

describe('append-only trails', () => {
  it('rejects UPDATE and DELETE on asset_history', async () => {
    const asset = await createAsset();
    const entry = await prisma.assetHistory.create({
      data: { assetId: asset.id, action: 'CREATED', toStatus: 'REGISTERED' },
    });
    await expect(
      prisma.assetHistory.update({ where: { id: entry.id }, data: { description: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.assetHistory.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects UPDATE and DELETE on activity_logs', async () => {
    const log = await prisma.activityLog.create({
      data: { action: 'asset.create', entityType: 'asset', newValues: { assetTag: 'AST-1' } },
    });
    await expect(
      prisma.activityLog.update({ where: { id: log.id }, data: { action: 'asset.delete' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.activityLog.delete({ where: { id: log.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('accessories and software', () => {
  it('prevents negative or over-allocated accessory stock', async () => {
    await expect(
      prisma.accessory.create({
        data: {
          name: 'USB-C charger',
          category: 'CHARGER',
          quantityTotal: 5,
          quantityAvailable: 6,
        },
      }),
    ).rejects.toThrow(/accessories_quantities_valid/);
  });

  it('assigns a license seat to exactly one target and once while active', async () => {
    const software = await prisma.software.create({
      data: { name: 'Microsoft 365', version: 'E3' },
    });
    const license = await prisma.softwareLicense.create({
      data: { softwareId: software.id, licenseType: 'SUBSCRIPTION', seats: 10 },
    });
    const asset = await createAsset();
    const employee = await createEmployee();

    await expect(
      prisma.softwareAssignment.create({
        data: { licenseId: license.id, assetId: asset.id, employeeId: employee.id },
      }),
    ).rejects.toThrow(/software_assignments_exactly_one_target/);

    const seat = await prisma.softwareAssignment.create({
      data: { licenseId: license.id, employeeId: employee.id },
    });
    await expectUniqueViolation(
      prisma.softwareAssignment.create({
        data: { licenseId: license.id, employeeId: employee.id },
      }),
    );

    await prisma.softwareAssignment.update({
      where: { id: seat.id },
      data: { unassignedAt: new Date() },
    });
    await expect(
      prisma.softwareAssignment.create({
        data: { licenseId: license.id, employeeId: employee.id },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects zero-quantity accessory hand-overs and inverted licence dates', async () => {
    const accessory = await prisma.accessory.create({
      data: { name: 'Mouse', category: 'MOUSE', quantityTotal: 3, quantityAvailable: 3 },
    });
    const employee = await createEmployee();
    await expect(
      prisma.accessoryAssignment.create({
        data: { accessoryId: accessory.id, employeeId: employee.id, quantity: 0 },
      }),
    ).rejects.toThrow(/accessory_assignments_quantity_positive/);

    const software = await prisma.software.create({ data: { name: 'Adobe Acrobat' } });
    await expect(
      prisma.softwareLicense.create({
        data: {
          softwareId: software.id,
          licenseType: 'SUBSCRIPTION',
          startDate: new Date('2026-06-01'),
          expiryDate: new Date('2026-01-01'),
        },
      }),
    ).rejects.toThrow(/software_licenses_dates/);
  });
});

describe('procurement, maintenance and audits', () => {
  it('rejects invalid purchase currency and negative maintenance costs', async () => {
    const vendor = await prisma.vendor.create({ data: { name: 'Dell Technologies' } });
    await expect(
      prisma.purchase.create({
        data: { vendorId: vendor.id, purchaseDate: new Date('2026-01-15'), currency: 'US$' },
      }),
    ).rejects.toThrow(/purchases_currency_iso/);

    const asset = await createAsset();
    await expect(
      prisma.maintenance.create({ data: { assetId: asset.id, title: 'Screen', laborCost: -10 } }),
    ).rejects.toThrow(/maintenance_costs_non_negative/);
  });

  it('requires audit items to reference an asset or a scanned code', async () => {
    const session = await prisma.auditSession.create({ data: { name: 'HQ Q3 audit' } });
    await expect(prisma.auditItem.create({ data: { auditSessionId: session.id } })).rejects.toThrow(
      /audit_items_asset_or_code/,
    );
    await expect(
      prisma.auditItem.create({
        data: {
          auditSessionId: session.id,
          scannedCode: 'UNKNOWN-123',
          expected: false,
          result: 'UNEXPECTED',
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe('users and helpdesk', () => {
  it('requires lower-case emails', async () => {
    await expect(
      prisma.user.create({ data: { email: 'Admin@Example.com', displayName: 'Admin' } }),
    ).rejects.toThrow(/users_email_lowercase/);
  });

  it('numbers tickets sequentially and cascades comments with the ticket', async () => {
    const t1 = await prisma.ticket.create({
      data: { title: 'Laptop fan noise', description: 'Loud fan' },
    });
    const t2 = await prisma.ticket.create({
      data: { title: 'VPN access', description: 'Need VPN' },
    });
    expect(t2.number).toBe(t1.number + 1);

    await prisma.ticketComment.create({ data: { ticketId: t1.id, body: 'Looking into it' } });
    await prisma.ticket.delete({ where: { id: t1.id } });
    expect(await prisma.ticketComment.count()).toBe(0);
  });
});
