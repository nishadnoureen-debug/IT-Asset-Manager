import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import { clearData, planClear } from '../src/database/clear-data';
import { seedDatabase } from '../src/database/seed';
import { createUser, truncateAll } from './db/helpers';

/**
 * Clearing a trial run: the devices, hand-outs and trails go; the people, their sign-ins and the
 * setup stay. Everything here is destructive by nature, so it runs against the test database only.
 */
const prisma = new PrismaClient();

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('clearing test data', () => {
  it('empties the records and keeps the people, their logins and the setup', async () => {
    const department = await prisma.department.create({
      data: { code: 'OPS', name: 'Operations' },
    });
    const location = await prisma.location.create({
      data: { code: 'CAMP', name: 'Camp Office', type: 'SITE' },
    });
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: 'E1',
        firstName: 'Priya',
        lastName: 'Raman',
        email: 'priya.raman@example.com',
        jobTitle: 'Site engineer',
        departmentId: department.id,
        locationId: location.id,
      },
    });
    const user = await createUser(prisma, 'ops@example.com', ROLES.IT_ADMINISTRATOR, employee.id);

    const assetType = await prisma.assetType.findFirstOrThrow();
    const asset = await prisma.asset.create({
      data: { assetTag: 'AST-900', name: 'Trial laptop', assetTypeId: assetType.id },
    });
    await prisma.assetAssignment.create({
      data: { assetId: asset.id, employeeId: employee.id, conditionAtAssignment: 'GOOD' },
    });
    await prisma.assetHistory.create({
      data: { assetId: asset.id, action: 'CREATED', description: 'Trial run' },
    });
    await prisma.accessory.create({
      data: { code: 'ACC-900', name: 'Trial charger', category: 'CHARGER', quantityTotal: 2 },
    });
    await prisma.activityLog.create({ data: { action: 'asset.create', entityType: 'asset' } });

    const plan = await planClear(prisma);
    expect(plan.counts.assets).toBe(1);
    expect(plan.counts.asset_history).toBeGreaterThan(0);
    expect(plan.counts.activity_logs).toBeGreaterThan(0);
    expect(plan.kept.employees).toBe(1);

    await clearData(prisma, plan);

    // Gone: every operational table, trails included — those refuse a row DELETE, hence TRUNCATE.
    const after = await planClear(prisma);
    expect(after.total).toBe(0);

    // Kept: the employee, complete, and the account that signs in as them.
    const stillThere = await prisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
      include: { department: true, location: true },
    });
    expect(stillThere.department?.name).toBe('Operations');
    expect(stillThere.location?.name).toBe('Camp Office');
    expect(stillThere.jobTitle).toBe('Site engineer');
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(1);

    // Kept: the setup an empty app still needs.
    expect(await prisma.assetType.count()).toBeGreaterThan(0);
    expect(await prisma.permission.count()).toBeGreaterThan(0);
    expect(await prisma.role.count()).toBeGreaterThan(0);
  });

  it('counts every table as either cleared or kept', async () => {
    // A table added later without a decision should stop the script, not be skipped silently.
    await expect(planClear(prisma)).resolves.toBeDefined();
  });

  it('starts asset tags from 001 again', async () => {
    const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('asset_tag_seq') AS nextval`;
    expect(Number(nextval)).toBe(1);
  });
});
