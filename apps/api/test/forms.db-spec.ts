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
 * Handover, transfer, return, asset request and SIM card swap forms in the company layout. Set
 * FORMS_OUT=<dir> to also write the generated PDFs to disk for a visual check.
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
  it('prints the fixed asset request form, with its own two approval boxes', async () => {
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
        type: 'REPLACEMENT',
        typeDetail: 'ARC-LT-0007',
        preferredModel: 'Dell Latitude 5450',
        accessoriesRequired: 'Bag, mouse, docking station',
        neededBy: '2026-10-15',
      })
      .expect(201);
    const id = created.body.data.id as string;

    const before = pdfText(await download(admin.auth, created.body.data.documents[0].id));
    for (const text of [
      'ASSET REQUEST FORM',
      'REQ-',
      'Employee Details',
      'OMAR HADDAD',
      'EMP101',
      'SITE SUPERVISOR',
      'JORDANIAN',
      'Asset Details',
      'Asset Type (Laptop / Mobile / Tablet / SIM / Other)',
      'Laptop',
      'Brand / Model Preferred',
      'Dell Latitude 5450',
      'Quantity',
      'Accessories Required',
      'Bag, mouse, docking station',
      'Required By (Date)',
      '15/10/2026',
      'Purpose / Justification',
      'The current laptop cannot run the survey software.',
      'Request Type',
      'New Requirement (Specify)',
      'Replacement (Old Asset Code)',
      'ARC-LT-0007',
      'Upgrade (Specify)',
      'Temporary Use (Return Date)',
      'Other Remarks',
      'Approved by:',
      'COMMERCIAL MANAGER',
      'TIJO GEORGE',
      'CHIEF OPERATING OFFICER',
      'MUHAMMED RAMSHID',
      'ARC GLOBAL TECHNICAL SERVICES',
    ])
      expect(before).toContain(text);
    // The form is fixed: the Settings → Forms signatory list does not reach it.
    for (const gone of [
      'HR DEPARTMENT',
      'IT DEPARTMENT',
      'FINANCE MANAGER',
      'FIN PERSON',
      'COMMERCIAL PERSON',
      'Requested For',
      'Request Details',
      'Priority',
      'Handover',
    ])
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
    // The form is replaced, so one current copy stays on the request.
    const forms = approved.body.data.documents.filter(
      (d: { type: string }) => d.type === 'REQUEST_FORM',
    );
    expect(forms).toHaveLength(1);
    const after = await download(admin.auth, forms[0].id);
    expect(pdfText(after)).toContain('ASSET REQUEST FORM');
    expect(pdfText(after)).not.toContain('issue from stock');
    if (process.env.FORMS_OUT)
      writeFileSync(join(process.env.FORMS_OUT, 'asset-request.pdf'), after);
  });

  it('prints the fixed SIM card swap request form', async () => {
    const admin = await login(app, 'it@example.com');
    const [omar, sara] = await Promise.all(
      ['EMP101', 'EMP202'].map((employeeNumber) =>
        prisma.employee.findFirstOrThrow({ where: { employeeNumber } }),
      ),
    );
    const plan = await http()
      .post(api('/sim-plans'))
      .set(admin.auth)
      .send({ name: 'Business 200', provider: 'e&', monthlyCharge: 200 })
      .expect(201);
    const card = await http()
      .post(api('/sim-cards'))
      .set(admin.auth)
      .send({
        phoneNumber: '0500000007',
        simNumber: '8997100000000000007',
        provider: 'e&',
        planId: plan.body.data.id,
        status: 'ACTIVE',
        employeeId: omar.id,
      })
      .expect(201);

    const swap = await http()
      .post(api(`/sim-cards/${card.body.data.id}/swaps`))
      .set(admin.auth)
      .send({
        toEmployeeId: sara.id,
        reason: 'STOLEN',
        reasonDetail: 'Bur Dubai 2026/4471',
        newSimNumber: '8997100000000000008',
        swappedAt: '2026-09-20',
        remarks: 'Handset stolen on site',
      })
      .expect(201);
    expect(swap.body.data.fromEmployee.employeeNumber).toBe('EMP101');
    expect(swap.body.data.toEmployee.employeeNumber).toBe('EMP202');

    const res = await http()
      .get(api(`/sim-swaps/${swap.body.data.id}/form`))
      .set(admin.auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = res.body as Buffer;
    const text = pdfText(pdf);
    for (const expected of [
      'SIM CARD SWAP REQUEST FORM',
      'SWP-',
      '20/09/2026',
      'Employee Details',
      'HANDED OVER BY (Current Holder)',
      'OMAR HADDAD',
      'EMP101',
      'RECEIVED BY (New Holder)',
      'SARA KHAN',
      'EMP202',
      'EGYPTIAN',
      'SIM Details',
      'Mobile Number',
      '0500000007',
      'Network Provider (e& / du)',
      'Plan / Package',
      'Business 200',
      'Replacement SIM (ICCID)',
      '8997100000000000008',
      'Reason for Swap',
      'Low Usage (Specify)',
      'Stolen (Police Report No.)',
      'Bur Dubai 2026/4471',
      'Damaged / Faulty SIM',
      'Upgrade to eSIM / New Device',
      'Other Remarks',
      'Handset stolen on site',
      // Both employees sign the form, under their own names.
      'OMAR HADDAD (signature)',
      'SARA KHAN (signature)',
      'Approved by:',
      'COMMERCIAL MANAGER',
      'TIJO GEORGE',
      'CHIEF OPERATING OFFICER',
      'MUHAMMED RAMSHID',
      'ARC GLOBAL TECHNICAL SERVICES',
    ])
      expect(text).toContain(expected);
    // Fixed form: the Settings → Forms signatories stay out of it.
    for (const gone of ['HR DEPARTMENT', 'FINANCE MANAGER', 'COMMERCIAL PERSON'])
      expect(text).not.toContain(gone);
    if (process.env.FORMS_OUT) writeFileSync(join(process.env.FORMS_OUT, 'sim-swap.pdf'), pdf);
  });

  it('prints both lines when two employees exchange their SIM cards', async () => {
    const admin = await login(app, 'it@example.com');
    const [omar, sara] = await Promise.all(
      ['EMP101', 'EMP202'].map((employeeNumber) =>
        prisma.employee.findFirstOrThrow({ where: { employeeNumber } }),
      ),
    );
    const plan = await prisma.simPlan.findFirstOrThrow({ where: { name: 'Business 200' } });
    const cards: { id: string }[] = [];
    for (const [phoneNumber, holder] of [
      ['0500000031', omar],
      ['0500000032', sara],
    ] as const) {
      const card = await http()
        .post(api('/sim-cards'))
        .set(admin.auth)
        .send({
          phoneNumber,
          provider: 'du',
          planId: plan.id,
          status: 'ACTIVE',
          employeeId: holder.id,
        })
        .expect(201);
      cards.push(card.body.data as { id: string });
    }

    const swap = await http()
      .post(api(`/sim-cards/${cards[0].id}/swaps`))
      .set(admin.auth)
      .send({ withSimCardId: cards[1].id, reason: 'OTHER', remarks: 'They exchanged numbers' })
      .expect(201);

    const res = await http()
      .get(api(`/sim-swaps/${swap.body.data.id}/form`))
      .set(admin.auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const pdf = res.body as Buffer;
    // Written before the assertions, so a failing layout can still be looked at.
    if (process.env.FORMS_OUT)
      writeFileSync(join(process.env.FORMS_OUT, 'sim-swap-exchange.pdf'), pdf);
    const text = pdfText(pdf);
    for (const expected of [
      'SIM CARD SWAP REQUEST FORM',
      'OMAR HADDAD',
      'SARA KHAN',
      'SIM Details',
      // Both lines, side by side.
      'HANDED OVER (SIM)',
      '0500000031',
      'RECEIVED IN EXCHANGE (SIM)',
      '0500000032',
      'Business 200',
      'OMAR HADDAD (signature)',
      'SARA KHAN (signature)',
      'Approved by:',
      'TIJO GEORGE',
    ])
      expect(text).toContain(expected);
    // Everything still fits on the one sheet people sign.
    expect(text).toContain('Page 1 of 1');
  });
});
