import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';

/** STORAGE_DRIVER=database: uploads live in PostgreSQL (hosting without a persistent disk). */
process.env.STORAGE_DRIVER = 'database';

const prisma = new PrismaClient();
let app: INestApplication;
let helpers: typeof import('./db/helpers');
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;

beforeAll(async () => {
  // Imported after the variable is set so the app's configuration sees it.
  helpers = await import('./db/helpers');
  await helpers.truncateAll(prisma);
  await seedDatabase(prisma);
  app = await helpers.createTestApp();
});

afterAll(async () => {
  delete process.env.STORAGE_DRIVER;
  await app?.close();
  await prisma.$disconnect();
});

describe('database file storage', () => {
  it('stores an uploaded document in PostgreSQL and serves it back unchanged', async () => {
    await helpers.createUser(prisma, 'admin@example.com', ROLES.SUPER_ADMIN);
    const admin = await helpers.login(app, 'admin@example.com');
    const location = await prisma.location.create({
      data: { code: 'STORE', name: 'Store room', type: 'WAREHOUSE' },
    });
    const laptop = await prisma.assetType.findUniqueOrThrow({ where: { name: 'Laptop' } });
    const asset = await http()
      .post(api('/assets'))
      .set(admin.auth)
      .send({ name: 'Latitude 7440', assetTypeId: laptop.id, locationId: location.id })
      .expect(201);

    const uploaded = await http()
      .post(api('/documents'))
      .set(admin.auth)
      .field('type', 'PHOTO')
      .field('assetId', asset.body.data.id)
      .attach('file', helpers.PNG_1PX, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.body.data.id } });
    const stored = await prisma.storedFile.findUniqueOrThrow({ where: { key: doc.storageKey } });
    expect(stored.contentType).toBe('image/png');
    expect(stored.sizeBytes).toBe(helpers.PNG_1PX.length);
    expect(Buffer.from(stored.data).equals(helpers.PNG_1PX)).toBe(true);

    const download = await http()
      .get(api(`/documents/${doc.id}/download`))
      .set(admin.auth)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((download.body as Buffer).equals(helpers.PNG_1PX)).toBe(true);
  });

  it('rejects a size that does not match the stored bytes', async () => {
    await expect(
      prisma.storedFile.create({
        data: {
          key: 'bad/size',
          contentType: 'text/plain',
          sizeBytes: 99,
          data: new Uint8Array([120]),
        },
      }),
    ).rejects.toThrow();
  });
});
