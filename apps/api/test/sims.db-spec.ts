import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';
import { createTestApp, createUser, login, truncateAll } from './db/helpers';

/** Company SIM cards: rate plans, the lines, what each line cost per month, and swaps. */
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

  it('swaps a line to another holder and keeps the SIM record in step', async () => {
    const admin = await login(app, 'it@example.com');
    const card = await prisma.simCard.findFirstOrThrow({ where: { phoneNumber: '0500000009' } });
    const holder = await prisma.employee.findFirstOrThrow({ where: { employeeNumber: 'EMP900' } });
    const receiver = await prisma.employee.create({
      data: {
        employeeNumber: 'EMP901',
        firstName: 'Sara',
        lastName: 'Khan',
        email: 'sara.sim@example.com',
      },
    });

    const swap = await http()
      .post(api(`/sim-cards/${card.id}/swaps`))
      .set(admin.auth)
      .send({
        toEmployeeId: receiver.id,
        reason: 'DAMAGED',
        reasonDetail: 'Cracked SIM tray',
        newSimNumber: '8997100000000000010',
        swappedAt: '2026-09-18',
      })
      .expect(201);
    // The holder it came from defaults to whoever held the line.
    expect(swap.body.data.fromEmployee.id).toBe(holder.id);
    expect(swap.body.data.previousSimNumber).toBe('8997100000000000009');
    expect(swap.body.data.number).toBeGreaterThan(0);

    // The line now belongs to the new holder, on the replacement SIM.
    const moved = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(moved.body.data.employee.employeeNumber).toBe('EMP901');
    expect(moved.body.data.simNumber).toBe('8997100000000000010');
    expect(moved.body.data.swaps).toHaveLength(1);

    // A replacement SIM another line already uses is refused.
    const other = await http()
      .post(api('/sim-cards'))
      .set(admin.auth)
      .send({ phoneNumber: '0500000011', simNumber: '8997100000000000011' })
      .expect(201);
    const clash = await http()
      .post(api(`/sim-cards/${card.id}/swaps`))
      .set(admin.auth)
      .send({ toEmployeeId: holder.id, newSimNumber: '8997100000000000011' })
      .expect(409);
    expect(clash.body.error.code).toBe('SIM_IN_USE');

    // A swap has to move something.
    const empty = await http()
      .post(api(`/sim-cards/${other.body.data.id}/swaps`))
      .set(admin.auth)
      .send({ reason: 'OTHER' })
      .expect(400);
    expect(empty.body.error.details[0].field).toBe('toEmployeeId');

    // Handing it back to nobody returns the line to stock.
    await http()
      .post(api(`/sim-cards/${card.id}/swaps`))
      .set(admin.auth)
      .send({ toEmployeeId: null, reason: 'LOW_USAGE', reasonDetail: '0.2 GB in three months' })
      .expect(201);
    const back = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(back.body.data.employee).toBeNull();
    expect(back.body.data.status).toBe('SPARE');

    // Both swaps are listed for the line, newest first, and can be filtered by employee.
    const listed = await http()
      .get(api(`/sim-swaps?simCardId=${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data[0].reason).toBe('LOW_USAGE');
    const byEmployee = await http()
      .get(api(`/sim-swaps?employeeId=${receiver.id}`))
      .set(admin.auth)
      .expect(200);
    expect(byEmployee.body.data).toHaveLength(2);

    // Older swaps stay put until the newer ones are undone.
    const tooEarly = await http()
      .delete(api(`/sim-swaps/${listed.body.data[1].id}`))
      .set(admin.auth)
      .expect(422);
    expect(tooEarly.body.error.code).toBe('INVALID_STATE');

    // Undoing the newest swap puts the line back with its previous holder.
    await http()
      .delete(api(`/sim-swaps/${listed.body.data[0].id}`))
      .set(admin.auth)
      .expect(200);
    const undone = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(undone.body.data.employee.employeeNumber).toBe('EMP901');
    expect(undone.body.data.status).toBe('ACTIVE');
    expect(undone.body.data.swaps).toHaveLength(1);

    // Undoing the first swap as well restores the original holder and SIM number.
    await http()
      .delete(api(`/sim-swaps/${listed.body.data[1].id}`))
      .set(admin.auth)
      .expect(200);
    const original = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(original.body.data.employee.employeeNumber).toBe('EMP900');
    expect(original.body.data.simNumber).toBe('8997100000000000009');
    expect(original.body.data.swaps).toHaveLength(0);
  });

  it('transfers a line to another employee, into the device they hold', async () => {
    const admin = await login(app, 'it@example.com');
    const card = await prisma.simCard.findFirstOrThrow({ where: { phoneNumber: '0500000009' } });
    const holder = await prisma.employee.findFirstOrThrow({ where: { employeeNumber: 'EMP900' } });
    const receiver = await prisma.employee.findFirstOrThrow({
      where: { employeeNumber: 'EMP901' },
    });

    // The receiver holds a laptop and a phone; a SIM belongs in the phone.
    const [laptopType, phoneType] = await Promise.all(
      ['Laptop', 'Mobile Phone'].map((name) =>
        prisma.assetType.findUniqueOrThrow({ where: { name } }),
      ),
    );
    const assets: { id: string; assetTag: string }[] = [];
    for (const [name, type] of [
      ['Latitude 5450', laptopType],
      ['Moto G75', phoneType],
    ] as const) {
      const asset = await http()
        .post(api('/assets'))
        .set(admin.auth)
        .send({ name, assetTypeId: type.id })
        .expect(201);
      await http()
        .post(api(`/assets/${asset.body.data.id}/assign`))
        .set(admin.auth)
        .send({ employeeId: receiver.id, condition: 'GOOD' })
        .expect(201);
      assets.push(asset.body.data as { id: string; assetTag: string });
    }
    const [laptop, phone] = assets;

    const transfer = await http()
      .post(api(`/sim-cards/${card.id}/transfer`))
      .set(admin.auth)
      .send({ toEmployeeId: receiver.id, remarks: 'Took over the site' })
      .expect(200);
    expect(transfer.body.data.reason).toBe('TRANSFER');
    // The line was with its original holder, so that is the side it comes from.
    expect(transfer.body.data.fromEmployee.employeeNumber).toBe('EMP900');
    // The phone wins over the laptop the same employee holds.
    expect(transfer.body.data.asset.assetTag).toBe(phone.assetTag);

    const moved = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(moved.body.data.employee.employeeNumber).toBe('EMP901');
    expect(moved.body.data.asset.assetTag).toBe(phone.assetTag);
    expect(moved.body.data.status).toBe('ACTIVE');

    // A named device is used as given, and shows up in the line's history.
    const again = await http()
      .post(api(`/sim-cards/${card.id}/transfer`))
      .set(admin.auth)
      .send({ toEmployeeId: holder.id, assetId: laptop.id })
      .expect(200);
    expect(again.body.data.asset.assetTag).toBe(laptop.assetTag);
    expect(again.body.data.previousAssetId).toBe(phone.id);

    // Undoing it puts both the holder and the device back.
    await http()
      .delete(api(`/sim-swaps/${again.body.data.id}`))
      .set(admin.auth)
      .expect(200);
    const back = await http()
      .get(api(`/sim-cards/${card.id}`))
      .set(admin.auth)
      .expect(200);
    expect(back.body.data.employee.employeeNumber).toBe('EMP901');
    expect(back.body.data.asset.assetTag).toBe(phone.assetTag);

    // A transfer needs someone to transfer to.
    const nobody = await http()
      .post(api(`/sim-cards/${card.id}/transfer`))
      .set(admin.auth)
      .send({ remarks: 'No one' })
      .expect(400);
    expect(nobody.body.error.details[0].field).toBe('toEmployeeId');
  });

  it('lets auditors look but not change, and hides SIMs from employees', async () => {
    const auditor = await login(app, 'auditor@example.com');
    const worker = await login(app, 'worker@example.com');

    await http().get(api('/sim-cards')).set(auditor.auth).expect(200);
    await http().get(api('/sim-swaps')).set(auditor.auth).expect(200);
    await http()
      .post(api('/sim-plans'))
      .set(auditor.auth)
      .send({ name: 'Auditor plan' })
      .expect(403);
    const card = await prisma.simCard.findFirstOrThrow({ where: { deletedAt: null } });
    await http()
      .post(api(`/sim-cards/${card.id}/swaps`))
      .set(auditor.auth)
      .send({ reason: 'OTHER', newSimNumber: '8997100000000000099' })
      .expect(403);
    await http()
      .delete(api(`/sim-swaps/00000000-0000-4000-8000-000000000000`))
      .set(auditor.auth)
      .expect(403);
    await http()
      .post(api(`/sim-cards/${card.id}/transfer`))
      .set(auditor.auth)
      .send({ toEmployeeId: '00000000-0000-4000-8000-000000000000' })
      .expect(403);
    await http().get(api('/sim-cards')).set(worker.auth).expect(403);
    await http().get(api('/sim-swaps')).set(worker.auth).expect(403);
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
