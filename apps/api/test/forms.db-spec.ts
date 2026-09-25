import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import request from 'supertest';
import { seedDatabase } from '../src/database/seed';
import { createTestApp, createUser, login, PNG_1PX, SIGNATURE, truncateAll } from './db/helpers';

/**
 * Handover, transfer and return forms in the company layout. Set FORMS_OUT=<dir> to also write the
 * generated PDFs to disk for a visual check.
 */
const prisma = new PrismaClient();
let app: INestApplication;
const http = () => request(app.getHttpServer());
const api = (path: string) => `/api/v1${path}`;

/** Text drawn in a PDFKit document: decodes the hex strings of every TJ operator, one per line. */
function pdfText(pdf: Buffer): string {
  const lines: string[] = [];
  const raw = pdf.toString('latin1');
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue; // images and other binary streams
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join('');
      lines.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  }
  return lines.join('\n');
}

async function download(auth: Record<string, string>, id: string): Promise<Buffer> {
  const res = await http()
    .get(api(`/documents/${id}/download`))
    .set(auth)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  return res.body as Buffer;
}

beforeAll(async () => {
  await truncateAll(prisma);
  await seedDatabase(prisma);
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('handover, transfer and return forms', () => {
  it('prints the company form with employee, device, condition, terms and signatories', async () => {
    await createUser(prisma, 'it@example.com', ROLES.SUPER_ADMIN);
    const admin = await login(app, 'it@example.com');
    await http()
      .patch(api('/settings'))
      .set(admin.auth)
      .send({
        companyName: 'ARC Global',
        formSignatories: [
          { title: 'HR Department', name: 'Hr Person' },
          { title: 'IT Department', name: 'It Person' },
          { title: 'Finance Manager', name: 'Fin Person' },
          { title: 'Commercial Manager', name: 'Commercial Person' },
          { title: 'Operations Manager', name: '' },
          { title: 'Chief Operating Officer', name: 'Coo Person' },
        ],
      })
      .expect(200);

    const store = await prisma.location.create({
      data: { code: 'STORE', name: 'Store room', type: 'WAREHOUSE' },
    });
    const [omar, sara] = await Promise.all(
      [
        ['EMP101', 'Omar', 'Haddad', 'Site Supervisor', 'Jordanian'],
        ['EMP202', 'Sara', 'Khan', 'Accountant', 'Egyptian'],
      ].map(([employeeNumber, firstName, lastName, jobTitle, nationality]) =>
        http()
          .post(api('/employees'))
          .set(admin.auth)
          .send({
            employeeNumber,
            firstName,
            lastName,
            jobTitle,
            nationality,
            email: `${firstName.toLowerCase()}@example.com`,
          })
          .expect(201)
          .then((r) => r.body.data as { id: string; nationality: string }),
      ),
    );
    expect(omar.nationality).toBe('Jordanian');
    const phoneType = await prisma.assetType.findUniqueOrThrow({ where: { name: 'Mobile Phone' } });
    const asset = await http()
      .post(api('/assets'))
      .set(admin.auth)
      .send({
        name: 'Moto G75',
        assetTypeId: phoneType.id,
        brand: 'Motorola',
        model: 'Moto G75 5G',
        phoneNumber: '0500000001',
        locationId: store.id,
      })
      .expect(201)
      .then((r) => r.body.data as { id: string; assetTag: string; phoneNumber: string });
    expect(asset.phoneNumber).toBe('0500000001');
    const sim = await prisma.accessory.create({
      data: { name: 'SIM', category: 'OTHER', quantityTotal: 5, quantityAvailable: 5 },
    });

    await http()
      .post(api(`/assets/${asset.id}/assign`))
      .set(admin.auth)
      .send({
        employeeId: omar.id,
        condition: 'NEW',
        accessories: [{ accessoryId: sim.id, quantity: 1 }],
        signature: SIGNATURE,
      })
      .expect(201);
    await http()
      .post(api(`/assets/${asset.id}/transfer`))
      .set(admin.auth)
      .send({ employeeId: sara.id, reason: 'Moved to accounts', condition: 'GOOD' })
      .expect(200);
    const active = await prisma.assetAssignment.findFirstOrThrow({
      where: { assetId: asset.id, status: 'ACTIVE' },
      include: { accessoryAssignments: true },
    });
    await http()
      .post(api(`/assets/${asset.id}/return`))
      .set(admin.auth)
      .send({
        condition: 'DAMAGED',
        notes: 'Cracked screen corner',
        accessories: [{ accessoryAssignmentId: active.accessoryAssignments[0].id, returned: true }],
      })
      .expect(200);

    const docs = await prisma.document.findMany({
      where: { assetId: asset.id, type: { in: ['HANDOVER_FORM', 'RETURN_FORM'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(docs.map((d) => d.originalFileName)).toEqual([
      `handover-${asset.assetTag}.pdf`,
      `transfer-${asset.assetTag}.pdf`,
      `return-${asset.assetTag}.pdf`,
    ]);
    expect(docs[0].title).toBe(`Handover form — ${asset.assetTag} (signed)`);
    expect(docs[1].title).toBe(`Transfer form — ${asset.assetTag}`);

    const [handover, transfer, ret] = await Promise.all(
      docs.map((d) => download(admin.auth, d.id)),
    );
    if (process.env.FORMS_OUT) {
      mkdirSync(process.env.FORMS_OUT, { recursive: true });
      for (const [name, pdf] of [
        ['handover', handover],
        ['transfer', transfer],
        ['return', ret],
      ] as const)
        writeFileSync(join(process.env.FORMS_OUT, `${name}.pdf`), pdf);
    }

    const h = pdfText(handover);
    for (const text of [
      'COMPANY ASSETS HANDOVER FORM',
      'Employee Details',
      'OMAR HADDAD',
      'EMP101',
      'SITE SUPERVISOR',
      'JORDANIAN',
      'Device Details',
      'Mobile Phone',
      'Motorola Moto G75 5G',
      asset.assetTag,
      '0500000001',
      'SIM',
      'Condition at Time of Handover',
      'Used but Functional',
      'Terms & Conditions',
      'The company-issued device(s) remain the property of ARC Global.',
      'Declaration',
      'Employee Signature',
      'Approved by:',
      'HR DEPARTMENT',
      'IT DEPARTMENT',
      'FINANCE MANAGER',
      'FIN PERSON',
      'CHIEF OPERATING OFFICER',
      'ARC GLOBAL TECHNICAL SERVICES',
    ])
      expect(h).toContain(text);
    // Signatories without a name leave the box empty for a handwritten name.
    expect(h).toContain('OPERATIONS MANAGER');
    // The signature image is embedded in the handover form.
    expect(handover.includes(Buffer.from('/Subtype /Image'))).toBe(true);
    expect(PNG_1PX.length).toBeGreaterThan(0);

    const t = pdfText(transfer);
    for (const text of [
      'ASSET TRANSFER FORM',
      'Transferred From',
      'OMAR HADDAD',
      'Transferred To',
      'SARA KHAN',
      'EGYPTIAN',
      'Condition at Time of Transfer',
      'Moved to accounts',
      // Both sides are named next to their signature lines.
      'Received By (name)',
      'Received By (signature)',
      'Handed Over By (name)',
      'Handed Over By (signature)',
    ])
      expect(t).toContain(text);

    const r = pdfText(ret);
    for (const text of [
      'COMPANY ASSETS RETURN FORM',
      'SARA KHAN',
      'Accessories Returned',
      'SIM (Returned)',
      'Condition at Time of Return',
      'Damaged',
      'Cracked screen corner',
      'Received By',
    ])
      expect(r).toContain(text);
    expect(r).not.toContain('Terms & Conditions');
  });
  it('prints the asset request form with the approval boxes and signature lines', async () => {
    const admin = await login(app, 'it@example.com');
    const omar = await prisma.employee.findFirstOrThrow({ where: { employeeNumber: 'EMP101' } });
    const laptopType = await prisma.assetType.findUniqueOrThrow({ where: { name: 'Laptop' } });
    const created = await http()
      .post(api('/requests'))
      .set(admin.auth)
      .send({
        title: 'Laptop for site survey',
        justification: 'The current laptop cannot run the survey software.',
        assetTypeId: laptopType.id,
        employeeId: omar.id,
        quantity: 2,
        priority: 'HIGH',
      })
      .expect(201);
    const id = created.body.data.id as string;

    const before = pdfText(await download(admin.auth, created.body.data.documents[0].id));
    for (const text of [
      'ASSET REQUEST FORM',
      'Requested For',
      'OMAR HADDAD',
      'EMP101',
      'Request Details',
      'Item Requested',
      'Laptop',
      'New asset',
      'Quantity',
      'Priority',
      'Raised By',
      'Justification',
      'The current laptop cannot run the survey software.',
      'Approved by:',
      'FINANCE MANAGER',
      'ARC GLOBAL TECHNICAL SERVICES',
    ])
      expect(before).toContain(text);
    // The decision lives in the system; the printed form is only countersigned.
    for (const gone of ['Approval', 'Approved By', 'Required By', 'Handover'])
      expect(before).not.toContain(gone);

    await http()
      .post(api(`/requests/${id}/approve`))
      .set(admin.auth)
      .send({ notes: 'Approved, issue from stock' })
      .expect(200);
    const approved = await http()
      .get(api(`/requests/${id}`))
      .set(admin.auth)
      .expect(200);
    // The form is replaced, so the printed copy shows the decision.
    const forms = approved.body.data.documents.filter(
      (d: { type: string }) => d.type === 'REQUEST_FORM',
    );
    expect(forms).toHaveLength(1);
    const after = pdfText(await download(admin.auth, forms[0].id));
    expect(after).toContain('ASSET REQUEST FORM');
    expect(after).toContain('FIN PERSON');
    expect(after).not.toContain('issue from stock');
    if (process.env.FORMS_OUT)
      writeFileSync(
        join(process.env.FORMS_OUT, 'asset-request.pdf'),
        await download(admin.auth, forms[0].id),
      );
  });
});
