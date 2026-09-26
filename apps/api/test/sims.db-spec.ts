import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';
import { createTestApp, createUser, login, truncateAll } from './db/helpers';

/** Company SIM cards: rate plans, the lines, and what each line cost per month. */
const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  app = await createTestApp();
  await createUser(prisma, 'it@example.com', ROLES.SUPER_ADMIN);
  await createUser(prisma, 'auditor@example.com', ROLES.AUDITOR);
  await createUser(prisma, 'worker@example.com', ROLES.EMPLOYEE);
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('SIM cards', () => {
  it('tracks a line from rate plan to monthly charges', async () => {
    const admin = await login(app, 'it@example.com');

    const plan = await http()
      .post(api('/sim-plans'))
      .set(admin.auth)
      .send({ name: 'Business 150', provider: 'Etisalat', monthlyCharge: 150 })
      .expect(201);
    expect(plan.body.data.currency).toBe('AED'); // the company default

    const employee = await prisma.employee.create({
      data: {
        employeeNumber: 'EMP900',
        firstName: 'Omar',
        lastName: 'Haddad',
        email: 'omar.sim@example.com',
      },
    });
    const card = await http()
      .post(api('/sim-cards'))
      .set(admin.auth)
      .send({
        phoneNumber: '0500000009',
        simNumber: '8997100000000000009',
        provider: 'Etisalat',
        planId: plan.body.data.id,
        status: 'ACTIVE',
        employeeId: employee.id,
      })
      .expect(201);
    const cardId = card.body.data.id as string;
    expect(card.body.data.plan.name).toBe('Business 150');
    expect(card.body.data.employee.employeeNumber).toBe('EMP900');

    // A second SIM cannot take the same number.
    const duplicate = await http()
      .post(api('/sim-cards'))
      .set(admin.auth)
      .send({ phoneNumber: '0500000009' })
      .expect(409);
    expect(duplicate.body.error.code).toBeDefined();

    // A month of charges: the monthly charge defaults to the plan's.
    const usage = await http()
      .post(api(`/sim-cards/${cardId}/usages`))
      .set(admin.auth)
      .send({
        period: '2026-09-15',
        excessUsage: 24.5,
        internationalCharges: 10,
        roamingCharges: 65.25,
        parkingCharges: 0,
        remarks: 'Roaming in KSA for the site visit',
      })
      .expect(201);
    expect(Number(usage.body.data.monthlyCharge)).toBe(150);
    expect(Number(usage.body.data.totalCharge)).toBe(249.75);
    // Any day of the month is stored as the first.
    expect(usage.body.data.period.slice(0, 10)).toBe('2026-09-01');

    // The same month cannot be recorded twice for one SIM.
    const again = await http()
      .post(api(`/sim-cards/${cardId}/usages`))
      .set(admin.auth)
      .send({ period: '2026-09-01' })
      .expect(409);
    expect(again.body.error.code).toBe('USAGE_EXISTS');

    // Correcting a charge keeps the total in step.
    const fixed = await http()
      .patch(api(`/sim-usages/${usage.body.data.id}`))
      .set(admin.auth)
      .send({ roamingCharges: 30 })
      .expect(200);
    expect(Number(fixed.body.data.totalCharge)).toBe(214.5);
    expect(Number(fixed.body.data.excessUsage)).toBe(24.5); // untouched

    // The month view totals every charge column.
    const month = await http()
      .get(api('/sim-usages?period=2026-09-10'))
      .set(admin.auth)
      .expect(200);
    expect(month.body.data).toHaveLength(1);
    expect(Number(month.body.meta.totals.totalCharge)).toBe(214.5);
    expect(Number(month.body.meta.totals.roamingCharges)).toBe(30);

    // The list shows the newest month against the line.
    const list = await http().get(api('/sim-cards')).set(admin.auth).expect(200);
    expect(list.body.data[0].usages[0].totalCharge).toBeDefined();

    // A plan in use cannot be deleted.
    const busy = await http()
      .delete(api(`/sim-plans/${plan.body.data.id}`))
      .set(admin.auth)
      .expect(422);
    expect(busy.body.error.code).toBe('INVALID_STATE');
  });

  it('lets auditors look but not change, and hides SIMs from employees', async () => {
    const auditor = await login(app, 'auditor@example.com');
    const worker = await login(app, 'worker@example.com');

    await http().get(api('/sim-cards')).set(auditor.auth).expect(200);
    await http()
      .post(api('/sim-plans'))
      .set(auditor.auth)
      .send({ name: 'Auditor plan' })
      .expect(403);
    await http().get(api('/sim-cards')).set(worker.auth).expect(403);
  });

  it('refuses charges that are not money and months that do not exist', async () => {
    const admin = await login(app, 'it@example.com');
    const card = await prisma.simCard.findFirstOrThrow({ where: { deletedAt: null } });
    const bad = await http()
      .post(api(`/sim-cards/${card.id}/usages`))
      .set(admin.auth)
      .send({ period: '2026-10-01', roamingCharges: -5 })
      .expect(400);
    expect(bad.body.error.details[0].field).toBe('roamingCharges');

    // The database keeps the stored total honest even if something bypasses the API.
    await expect(
      prisma.simUsage.create({
        data: {
          simCardId: card.id,
          period: new Date('2026-11-01'),
          monthlyCharge: 100,
          totalCharge: 5,
          currency: 'AED',
        },
      }),
    ).rejects.toThrow(/sim_usages_total_check/);
  });
});
