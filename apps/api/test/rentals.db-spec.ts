import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';
import { createTestApp, createUser, login, truncateAll } from './db/helpers';

/** Camp rentals: WiFi cards issued to employees and washing times on the camp machines. */
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

describe('camp rentals', () => {
  it('issues a WiFi card until it comes back, one employee at a time', async () => {
    const admin = await login(app, 'it@example.com');

    const camp = await http()
      .post(api('/camps'))
      .set(admin.auth)
      .send({ name: 'Jebel Ali Camp', code: 'JAC', location: 'Jebel Ali, Dubai' })
      .expect(201);
    const campId = camp.body.data.id as string;

    const card = await http()
      .post(api('/rental-items'))
      .set(admin.auth)
      .send({
        campId,
        type: 'WIFI_CARD',
        name: 'WiFi card 12',
        code: 'WIFI-012',
        provider: 'du',
        standardCharge: 60,
      })
      .expect(201);
    expect(card.body.data.currency).toBe('AED'); // the company default
    expect(card.body.data.status).toBe('AVAILABLE');
    expect(card.body.data.camp.name).toBe('Jebel Ali Camp');
    const cardId = card.body.data.id as string;

    const [omar, sara] = await Promise.all(
      [
        ['EMP700', 'Omar', 'Haddad'],
        ['EMP701', 'Sara', 'Khan'],
      ].map(([employeeNumber, firstName, lastName]) =>
        prisma.employee.create({
          data: {
            employeeNumber,
            firstName,
            lastName,
            email: `${firstName.toLowerCase()}.camp@example.com`,
          },
        }),
      ),
    );

    // Issued with no end: it stays out until it is taken back.
    const issued = await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({ itemId: cardId, employeeId: omar.id, startAt: '2026-09-01T08:00:00.000Z' })
      .expect(201);
    expect(issued.body.data.status).toBe('ACTIVE');
    expect(issued.body.data.endAt).toBeNull();
    // The charge falls back to the item's usual one.
    expect(Number(issued.body.data.charge)).toBe(60);
    const rentalId = issued.body.data.id as string;

    const out = await http()
      .get(api(`/rental-items/${cardId}`))
      .set(admin.auth)
      .expect(200);
    expect(out.body.data.status).toBe('RENTED');

    // Nobody else can have it while it is out.
    const clash = await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({ itemId: cardId, employeeId: sara.id, startAt: '2026-09-05T08:00:00.000Z' })
      .expect(409);
    expect(clash.body.error.code).toBe('RENTAL_OVERLAP');
    expect(clash.body.error.message).toContain('Omar Haddad');

    // An item that is still out cannot be archived.
    const busy = await http()
      .delete(api(`/rental-items/${cardId}`))
      .set(admin.auth)
      .expect(422);
    expect(busy.body.error.code).toBe('INVALID_STATE');

    // Taking it back frees the card and prices the rental.
    const back = await http()
      .post(api(`/rentals/${rentalId}/end`))
      .set(admin.auth)
      .send({ endAt: '2026-10-01T08:00:00.000Z', charge: 60 })
      .expect(200);
    expect(back.body.data.status).toBe('COMPLETED');
    const free = await http()
      .get(api(`/rental-items/${cardId}`))
      .set(admin.auth)
      .expect(200);
    expect(free.body.data.status).toBe('AVAILABLE');

    // And now the next employee can take it.
    await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({ itemId: cardId, employeeId: sara.id, startAt: '2026-10-02T08:00:00.000Z' })
      .expect(201);

    // A camp with items stays put.
    const campBusy = await http()
      .delete(api(`/camps/${campId}`))
      .set(admin.auth)
      .expect(422);
    expect(campBusy.body.error.code).toBe('INVALID_STATE');
  });

  it('records washing times without holding the machine', async () => {
    const admin = await login(app, 'it@example.com');
    const camp = await prisma.camp.findFirstOrThrow({ where: { code: 'JAC' } });
    const [omar, sara] = await Promise.all(
      ['EMP700', 'EMP701'].map((employeeNumber) =>
        prisma.employee.findFirstOrThrow({ where: { employeeNumber } }),
      ),
    );

    const machine = await http()
      .post(api('/rental-items'))
      .set(admin.auth)
      .send({
        campId: camp.id,
        type: 'WASHING_MACHINE',
        name: 'Washing machine 1',
        code: 'WM-01',
        provider: 'LG',
        standardCharge: 10,
      })
      .expect(201);
    const machineId = machine.body.data.id as string;

    // A finished washing time is recorded as it happened; the machine stays free.
    const wash = await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({
        itemId: machineId,
        employeeId: omar.id,
        startAt: '2026-09-20T17:00:00.000Z',
        endAt: '2026-09-20T18:30:00.000Z',
      })
      .expect(201);
    expect(wash.body.data.status).toBe('COMPLETED');
    expect(Number(wash.body.data.charge)).toBe(10);
    const stillFree = await http()
      .get(api(`/rental-items/${machineId}`))
      .set(admin.auth)
      .expect(200);
    expect(stillFree.body.data.status).toBe('AVAILABLE');

    // Two people cannot wash at once.
    const overlap = await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({
        itemId: machineId,
        employeeId: sara.id,
        startAt: '2026-09-20T18:00:00.000Z',
        endAt: '2026-09-20T19:00:00.000Z',
      })
      .expect(409);
    expect(overlap.body.error.code).toBe('RENTAL_OVERLAP');

    // The slot after it is fine.
    await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({
        itemId: machineId,
        employeeId: sara.id,
        startAt: '2026-09-20T18:30:00.000Z',
        endAt: '2026-09-20T20:00:00.000Z',
        remarks: 'Two loads',
      })
      .expect(201);

    // A washing time has to end after it starts.
    const backwards = await http()
      .post(api('/rentals'))
      .set(admin.auth)
      .send({
        itemId: machineId,
        employeeId: sara.id,
        startAt: '2026-09-21T10:00:00.000Z',
        endAt: '2026-09-21T09:00:00.000Z',
      })
      .expect(400);
    expect(backwards.body.error.details[0].field).toBe('endAt');

    // The camp's washing times, and what was running on one day.
    const washes = await http()
      .get(api(`/rentals?campId=${camp.id}&type=WASHING_MACHINE`))
      .set(admin.auth)
      .expect(200);
    expect(washes.body.data).toHaveLength(2);
    const onTheDay = await http().get(api('/rentals?on=2026-09-20')).set(admin.auth).expect(200);
    expect(onTheDay.body.data.length).toBeGreaterThanOrEqual(2);

    // The database keeps a stored period honest even if something bypasses the API.
    await expect(
      prisma.rental.create({
        data: {
          itemId: machineId,
          employeeId: omar.id,
          startAt: new Date('2026-09-22T10:00:00.000Z'),
          endAt: new Date('2026-09-22T09:00:00.000Z'),
          currency: 'AED',
        },
      }),
    ).rejects.toThrow(/rentals_period_check/);
  });

  it('lets auditors look but not change, and hides rentals from employees', async () => {
    const auditor = await login(app, 'auditor@example.com');
    const worker = await login(app, 'worker@example.com');

    await http().get(api('/rentals')).set(auditor.auth).expect(200);
    await http().get(api('/camps')).set(auditor.auth).expect(200);
    await http().post(api('/camps')).set(auditor.auth).send({ name: 'Auditor camp' }).expect(403);
    await http().get(api('/rentals')).set(worker.auth).expect(403);
    await http().get(api('/rental-items')).set(worker.auth).expect(403);
  });
});
