import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AssetCondition, PrismaClient } from '@prisma/client';
import { ROLES } from '@itam/shared';
import { AppModule } from '../app.module';
import { AssetsService } from '../assets/assets.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { PasswordService } from '../auth/password.service';
import { UserAccessService } from '../auth/user-access.service';
import { AlertsScheduler } from '../notifications/alerts.scheduler';
import { PrismaService } from '../prisma/prisma.service';
import { seedDatabase } from './seed';

/**
 * Demo data for exploring the application locally. Runs through the real services so history,
 * handover PDFs, notifications and activity logs are all genuine.
 *
 *   npm run db:seed:demo            (skips if demo data already exists)
 *
 * Never run against production.
 */

const day = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * day);
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production');
  process.env.ENABLE_SCHEDULER = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    await seedDatabase(prisma as unknown as PrismaClient);
    if (await prisma.department.findUnique({ where: { code: 'IT' } })) {
      console.log('Demo data already present — nothing to do.');
      return;
    }

    const passwords = app.get(PasswordService);
    const access = app.get(UserAccessService);
    const assets = app.get(AssetsService);
    const assignments = app.get(AssignmentsService);

    // ── Organisation ────────────────────────────────────────────────────────
    const dept = Object.fromEntries(
      await Promise.all(
        [
          ['IT', 'Information Technology'],
          ['FIN', 'Finance'],
          ['HR', 'Human Resources'],
          ['OPS', 'Operations'],
          ['SALES', 'Sales'],
        ].map(async ([code, name]) => [code, await prisma.department.create({ data: { code, name } })]),
      ),
    );
    const hq = await prisma.location.create({ data: { code: 'HQ', name: 'Head Office', type: 'SITE', city: 'Dubai', country: 'United Arab Emirates' } });
    const loc = {
      HQ: hq,
      F1: await prisma.location.create({ data: { code: 'HQ-F1', name: 'Head Office · Floor 1', type: 'FLOOR', parentId: hq.id } }),
      F2: await prisma.location.create({ data: { code: 'HQ-F2', name: 'Head Office · Floor 2', type: 'FLOOR', parentId: hq.id } }),
      SRV: await prisma.location.create({ data: { code: 'HQ-SRV', name: 'Server Room', type: 'DATA_CENTER', parentId: hq.id } }),
      WH: await prisma.location.create({ data: { code: 'WH', name: 'IT Store Room', type: 'WAREHOUSE', city: 'Dubai' } }),
      REMOTE: await prisma.location.create({ data: { code: 'REMOTE', name: 'Remote / Home office', type: 'REMOTE' } }),
    };

    const people: [string, string, string, string, keyof typeof loc, string][] = [
      ['E1001', 'Sara', 'Khan', 'IT', 'F1', 'IT Manager'],
      ['E1002', 'Omar', 'Haddad', 'IT', 'F1', 'IT Technician'],
      ['E1003', 'Priya', 'Nair', 'FIN', 'F2', 'Finance Manager'],
      ['E1004', 'James', 'Walker', 'FIN', 'F2', 'Accountant'],
      ['E1005', 'Layla', 'Mansour', 'HR', 'F2', 'HR Specialist'],
      ['E1006', 'Daniel', 'Costa', 'OPS', 'F1', 'Operations Lead'],
      ['E1007', 'Aisha', 'Rahman', 'SALES', 'REMOTE', 'Account Executive'],
      ['E1008', 'Chen', 'Wei', 'SALES', 'F1', 'Sales Manager'],
      ['E1009', 'Fatima', 'Ali', 'OPS', 'F1', 'Coordinator'],
      ['E1010', 'Lucas', 'Meyer', 'IT', 'SRV', 'Systems Engineer'],
    ];
    const emp: Record<string, Awaited<ReturnType<typeof prisma.employee.create>>> = {};
    for (const [number, first, last, d, l, title] of people) {
      emp[number] = await prisma.employee.create({
        data: {
          employeeNumber: number,
          firstName: first,
          lastName: last,
          email: `${first}.${last}@demo.local`.toLowerCase(),
          departmentId: dept[d].id,
          locationId: loc[l].id,
          jobTitle: title,
          hireDate: dateOnly(daysFromNow(-400 - Math.floor(Math.random() * 900))),
        },
      });
    }
    await prisma.department.update({ where: { id: dept.IT.id }, data: { managerId: emp.E1001.id } });
    await prisma.department.update({ where: { id: dept.FIN.id }, data: { managerId: emp.E1003.id } });

    // ── Users (one per role) ────────────────────────────────────────────────
    const demoPassword = `Demo-${randomBytes(6).toString('base64url')}9`;
    const passwordHash = await passwords.hash(demoPassword);
    const roles = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r]));
    const users: [string, string, string, string | null][] = [
      ['it.admin@demo.local', 'Sara Khan', ROLES.IT_ADMINISTRATOR, emp.E1001.id],
      ['technician@demo.local', 'Omar Haddad', ROLES.IT_TECHNICIAN, emp.E1002.id],
      ['manager@demo.local', 'Priya Nair', ROLES.DEPARTMENT_MANAGER, emp.E1003.id],
      ['employee@demo.local', 'James Walker', ROLES.EMPLOYEE, emp.E1004.id],
      ['auditor@demo.local', 'Audit Team', ROLES.AUDITOR, null],
    ];
    const userIds: Record<string, string> = {};
    for (const [email, displayName, role, employeeId] of users) {
      const u = await prisma.user.create({
        data: { email, displayName, passwordHash, passwordChangedAt: new Date(), employeeId, roles: { create: { roleId: roles[role].id } } },
      });
      userIds[role] = u.id;
    }
    const admin = (await access.get(userIds[ROLES.IT_ADMINISTRATOR]))!;

    // ── Vendors & purchases ─────────────────────────────────────────────────
    const vendor = {
      dell: await prisma.vendor.create({ data: { name: 'Dell Technologies', types: ['MANUFACTURER', 'SUPPLIER', 'WARRANTY_PROVIDER'], email: 'sales@dell.example', website: 'https://www.dell.com' } }),
      lenovo: await prisma.vendor.create({ data: { name: 'Lenovo', types: ['MANUFACTURER', 'WARRANTY_PROVIDER'], website: 'https://www.lenovo.com' } }),
      apple: await prisma.vendor.create({ data: { name: 'Apple', types: ['MANUFACTURER', 'SUPPLIER'] } }),
      cisco: await prisma.vendor.create({ data: { name: 'Cisco', types: ['MANUFACTURER'] } }),
      microsoft: await prisma.vendor.create({ data: { name: 'Microsoft', types: ['SOFTWARE_PUBLISHER'] } }),
      adobe: await prisma.vendor.create({ data: { name: 'Adobe', types: ['SOFTWARE_PUBLISHER'] } }),
      service: await prisma.vendor.create({ data: { name: 'Gulf IT Services LLC', types: ['SERVICE_PROVIDER', 'SUPPLIER'], contactName: 'Ahmed Saleh', phone: '+971 4 000 0000' } }),
    };
    const po1 = await prisma.purchase.create({ data: { orderNumber: 'PO-2025-014', invoiceNumber: 'INV-88121', vendorId: vendor.dell.id, purchaseDate: dateOnly(daysFromNow(-700)), currency: 'USD', subtotal: 16800, taxAmount: 840, totalAmount: 17640, createdById: admin.id } });
    const po2 = await prisma.purchase.create({ data: { orderNumber: 'PO-2026-003', invoiceNumber: 'LN-55310', vendorId: vendor.lenovo.id, purchaseDate: dateOnly(daysFromNow(-120)), currency: 'USD', subtotal: 9600, taxAmount: 480, totalAmount: 10080, createdById: admin.id } });
    const po3 = await prisma.purchase.create({ data: { orderNumber: 'PO-2026-021', invoiceNumber: 'GIS-2210', vendorId: vendor.service.id, purchaseDate: dateOnly(daysFromNow(-30)), currency: 'USD', subtotal: 2400, taxAmount: 120, totalAmount: 2520, createdById: admin.id } });

    // ── Assets ──────────────────────────────────────────────────────────────
    const types = Object.fromEntries((await prisma.assetType.findMany()).map((t) => [t.name, t]));
    const created: Record<string, string> = {};
    const assetSpecs: {
      key: string; name: string; type: string; brand: string; model: string; serial: string; cost: number;
      vendor: string; purchase?: string; bought: number; warranty: number; location: keyof typeof loc; department?: string;
    }[] = [
      { key: 'L1', name: 'Latitude 7440', type: 'Laptop', brand: 'Dell', model: 'Latitude 7440', serial: 'DL7440-A1', cost: 1450, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 20, location: 'WH', department: 'IT' },
      { key: 'L2', name: 'Latitude 7440', type: 'Laptop', brand: 'Dell', model: 'Latitude 7440', serial: 'DL7440-A2', cost: 1450, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 20, location: 'WH', department: 'FIN' },
      { key: 'L3', name: 'Latitude 5540', type: 'Laptop', brand: 'Dell', model: 'Latitude 5540', serial: 'DL5540-B1', cost: 1100, vendor: 'dell', purchase: 'po1', bought: -700, warranty: -15, location: 'WH', department: 'HR' },
      { key: 'L4', name: 'ThinkPad T14 Gen 5', type: 'Laptop', brand: 'Lenovo', model: 'T14 Gen 5', serial: 'LNT14-0001', cost: 1600, vendor: 'lenovo', purchase: 'po2', bought: -120, warranty: 975, location: 'WH', department: 'SALES' },
      { key: 'L5', name: 'ThinkPad T14 Gen 5', type: 'Laptop', brand: 'Lenovo', model: 'T14 Gen 5', serial: 'LNT14-0002', cost: 1600, vendor: 'lenovo', purchase: 'po2', bought: -120, warranty: 975, location: 'WH', department: 'OPS' },
      { key: 'L6', name: 'ThinkPad X1 Carbon', type: 'Laptop', brand: 'Lenovo', model: 'X1 Carbon Gen 12', serial: 'LNX1-7781', cost: 2200, vendor: 'lenovo', purchase: 'po2', bought: -120, warranty: 975, location: 'WH', department: 'SALES' },
      { key: 'L7', name: 'MacBook Pro 14"', type: 'Laptop', brand: 'Apple', model: 'MacBook Pro M3', serial: 'C02MBP14X9', cost: 2400, vendor: 'apple', bought: -300, warranty: 65, location: 'WH', department: 'IT' },
      { key: 'D1', name: 'OptiPlex 7010', type: 'Desktop', brand: 'Dell', model: 'OptiPlex 7010', serial: 'DOPT-7010-1', cost: 900, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 395, location: 'F2', department: 'FIN' },
      { key: 'D2', name: 'OptiPlex 7010', type: 'Desktop', brand: 'Dell', model: 'OptiPlex 7010', serial: 'DOPT-7010-2', cost: 900, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 395, location: 'F1', department: 'OPS' },
      { key: 'M1', name: 'UltraSharp 27" Monitor', type: 'Monitor', brand: 'Dell', model: 'U2723QE', serial: 'DU27-1001', cost: 520, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 395, location: 'WH' },
      { key: 'M2', name: 'UltraSharp 27" Monitor', type: 'Monitor', brand: 'Dell', model: 'U2723QE', serial: 'DU27-1002', cost: 520, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 395, location: 'WH' },
      { key: 'M3', name: 'ThinkVision 24" Monitor', type: 'Monitor', brand: 'Lenovo', model: 'T24i-30', serial: 'LTV24-3001', cost: 210, vendor: 'lenovo', purchase: 'po2', bought: -120, warranty: 975, location: 'WH' },
      { key: 'P1', name: 'iPhone 15', type: 'Mobile Phone', brand: 'Apple', model: 'iPhone 15', serial: 'F2LX15AAA1', cost: 999, vendor: 'apple', bought: -200, warranty: 165, location: 'WH', department: 'SALES' },
      { key: 'P2', name: 'Galaxy S24', type: 'Mobile Phone', brand: 'Samsung', model: 'S24', serial: 'R58S24B002', cost: 899, vendor: 'service', purchase: 'po3', bought: -30, warranty: 700, location: 'WH', department: 'OPS' },
      { key: 'T1', name: 'iPad Air', type: 'Tablet', brand: 'Apple', model: 'iPad Air M2', serial: 'DMPIPAD881', cost: 749, vendor: 'apple', bought: -200, warranty: 12, location: 'WH', department: 'OPS' },
      { key: 'PR1', name: 'LaserJet Pro Printer', type: 'Printer', brand: 'HP', model: 'M404dn', serial: 'HPLJ404-77', cost: 380, vendor: 'service', purchase: 'po3', bought: -30, warranty: 335, location: 'F2' },
      { key: 'S1', name: 'PowerEdge R760 Server', type: 'Server', brand: 'Dell', model: 'R760', serial: 'DPER760-01', cost: 8900, vendor: 'dell', purchase: 'po1', bought: -700, warranty: 1125, location: 'SRV', department: 'IT' },
      { key: 'N1', name: 'Catalyst 9300 Switch', type: 'Network Equipment', brand: 'Cisco', model: 'C9300-48P', serial: 'FOC2233X0AB', cost: 5200, vendor: 'cisco', bought: -700, warranty: 25, location: 'SRV', department: 'IT' },
      { key: 'PJ1', name: 'Meeting Room Projector', type: 'Projector', brand: 'Epson', model: 'EB-L630U', serial: 'EPS630U-12', cost: 1800, vendor: 'service', purchase: 'po3', bought: -30, warranty: 700, location: 'F1' },
      { key: 'L8', name: 'Latitude 5440 (old)', type: 'Laptop', brand: 'Dell', model: 'Latitude 5440', serial: 'DL5440-OLD', cost: 950, vendor: 'dell', bought: -1600, warranty: -700, location: 'WH', department: 'IT' },
    ];
    const vendorIds: Record<string, string> = Object.fromEntries(Object.entries(vendor).map(([k, v]) => [k, v.id]));
    const purchases: Record<string, string> = { po1: po1.id, po2: po2.id, po3: po3.id };
    for (const a of assetSpecs) {
      const asset = await assets.create(
        {
          name: a.name,
          assetTypeId: types[a.type].id,
          brand: a.brand,
          model: a.model,
          serialNumber: a.serial,
          purchaseCost: a.cost,
          currency: 'USD',
          vendorId: vendorIds[a.vendor],
          purchaseId: a.purchase ? purchases[a.purchase] : undefined,
          purchaseDate: dateOnly(daysFromNow(a.bought)),
          warrantyProviderId: ['dell', 'lenovo'].includes(a.vendor) ? vendorIds[a.vendor] : undefined,
          warrantyStartDate: dateOnly(daysFromNow(a.bought)),
          warrantyEndDate: dateOnly(daysFromNow(a.warranty)),
          warrantyCoverage: 'Parts and labour, next business day on-site',
          locationId: loc[a.location].id,
          departmentId: a.department ? dept[a.department].id : undefined,
          condition: a.bought < -600 ? 'GOOD' : 'NEW',
          status: 'IN_STOCK',
        },
        admin,
      );
      created[a.key] = asset.id;
    }

    // ── Accessories ─────────────────────────────────────────────────────────
    const charger = await prisma.accessory.create({ data: { name: 'USB-C 65W Charger', category: 'CHARGER', sku: 'ACC-CHG-65', quantityTotal: 25, quantityAvailable: 25, minStockLevel: 5, locationId: loc.WH.id, unitCost: 39, currency: 'USD' } });
    const mouse = await prisma.accessory.create({ data: { name: 'Wireless Mouse', category: 'MOUSE', sku: 'ACC-MSE-01', quantityTotal: 30, quantityAvailable: 30, minStockLevel: 8, locationId: loc.WH.id, unitCost: 25, currency: 'USD' } });
    const bag = await prisma.accessory.create({ data: { name: 'Laptop Backpack', category: 'BAG', sku: 'ACC-BAG-15', quantityTotal: 12, quantityAvailable: 12, minStockLevel: 4, locationId: loc.WH.id, unitCost: 45, currency: 'USD' } });
    const dock = await prisma.accessory.create({ data: { name: 'Thunderbolt Dock', category: 'DOCKING_STATION', sku: 'ACC-DCK-TB4', quantityTotal: 6, quantityAvailable: 6, minStockLevel: 3, locationId: loc.WH.id, unitCost: 220, currency: 'USD' } });
    await prisma.accessory.create({ data: { name: 'Noise-cancelling Headset', category: 'HEADSET', sku: 'ACC-HDS-01', quantityTotal: 4, quantityAvailable: 4, minStockLevel: 4, locationId: loc.WH.id, unitCost: 120, currency: 'USD' } });

    // ── Assignments (real workflows) ────────────────────────────────────────
    const assign = (key: string, employee: string, condition: AssetCondition, accessories: { accessoryId: string; quantity: number }[] = [], extra: object = {}) =>
      assignments.assign(created[key], { employeeId: emp[employee].id, condition, accessories, notes: 'Standard issue', ...extra }, admin);

    await assign('L1', 'E1002', 'GOOD', [{ accessoryId: charger.id, quantity: 1 }, { accessoryId: mouse.id, quantity: 1 }]);
    await assign('L2', 'E1004', 'GOOD', [{ accessoryId: charger.id, quantity: 1 }, { accessoryId: bag.id, quantity: 1 }]);
    await assign('L4', 'E1007', 'NEW', [{ accessoryId: charger.id, quantity: 1 }, { accessoryId: bag.id, quantity: 1 }], { expectedReturnAt: daysFromNow(-5) });
    await assign('L5', 'E1006', 'NEW', [{ accessoryId: charger.id, quantity: 1 }, { accessoryId: dock.id, quantity: 1 }]);
    await assign('L6', 'E1008', 'NEW', [{ accessoryId: charger.id, quantity: 1 }]);
    await assign('L7', 'E1001', 'NEW', [{ accessoryId: dock.id, quantity: 1 }]);
    await assign('P1', 'E1007', 'NEW');
    await assign('M1', 'E1004', 'GOOD');
    await assign('D1', 'E1003', 'GOOD');
    await assign('T1', 'E1009', 'NEW');
    await assignments.assign(created.PJ1, { locationId: loc.F1.id, condition: 'NEW', notes: 'Meeting room 1.04' }, admin);
    await assignments.assign(created.S1, { locationId: loc.SRV.id, condition: 'NEW', notes: 'Rack A, U12-14' }, admin);

    // Return, then transfer — history shows the full chain.
    await assign('L3', 'E1005', 'GOOD', [{ accessoryId: charger.id, quantity: 1 }]);
    await assignments.returnAsset(created.L3, { condition: 'FAIR', returnTo: 'IN_STOCK', notes: 'Replaced by newer device' }, admin);
    await assign('M2', 'E1006', 'GOOD');
    await assignments.transfer(created.M2, { employeeId: emp.E1009.id, reason: 'Desk move to operations coordinator', condition: 'GOOD' }, admin);

    // Employee acknowledges one of their assets.
    const employeeUser = (await access.get(userIds[ROLES.EMPLOYEE]))!;
    const m1Assignment = await prisma.assetAssignment.findFirstOrThrow({ where: { assetId: created.M1, status: 'ACTIVE' } });
    await assignments.acknowledge(m1Assignment.id, {}, employeeUser);

    // ── Maintenance ─────────────────────────────────────────────────────────
    const tech = userIds[ROLES.IT_TECHNICIAN];
    const now = new Date();
    await prisma.maintenance.create({
      data: {
        assetId: created.PR1, type: 'PREVENTIVE', status: 'SCHEDULED', priority: 'LOW', title: 'Quarterly printer service',
        technicianId: tech, vendorId: vendor.service.id, scheduledAt: daysFromNow(2), reportedById: admin.id,
      },
    });
    const repair = await prisma.maintenance.create({
      data: {
        assetId: created.L6, type: 'REPAIR', status: 'IN_PROGRESS', priority: 'HIGH', title: 'Keyboard not responding',
        description: 'Several keys intermittently fail.', technicianId: tech, vendorId: vendor.lenovo.id, isWarrantyClaim: true,
        startedAt: now, assetStatusBefore: 'ASSIGNED', reportedById: admin.id,
      },
    });
    await assets.setStatus(prisma, created.L6, 'ASSIGNED', 'IN_REPAIR');
    await prisma.assetHistory.create({ data: { assetId: created.L6, action: 'MAINTENANCE_STARTED', fromStatus: 'ASSIGNED', toStatus: 'IN_REPAIR', maintenanceId: repair.id, performedById: tech, description: repair.title } });
    await prisma.maintenance.create({
      data: {
        assetId: created.D2, type: 'UPGRADE', status: 'COMPLETED', priority: 'MEDIUM', title: 'RAM upgrade to 32 GB',
        technicianId: tech, startedAt: daysFromNow(-10), completedAt: daysFromNow(-9), laborCost: 40, partsCost: 110, totalCost: 150,
        currency: 'USD', resolutionNotes: 'Installed 2×16 GB DDR5, memtest passed.', reportedById: admin.id,
      },
    });

    // ── Retired asset ───────────────────────────────────────────────────────
    await assets.retire(created.L8, { reason: 'End of life — battery swollen, out of warranty' }, admin);

    // ── Software & licences ─────────────────────────────────────────────────
    const m365 = await prisma.software.create({ data: { name: 'Microsoft 365', version: 'E3', publisherId: vendor.microsoft.id, category: 'Productivity' } });
    const acrobat = await prisma.software.create({ data: { name: 'Adobe Acrobat Pro', version: '2024', publisherId: vendor.adobe.id, category: 'Documents' } });
    const win = await prisma.software.create({ data: { name: 'Windows 11 Pro', publisherId: vendor.microsoft.id, category: 'Operating system' } });
    const m365Lic = await prisma.softwareLicense.create({ data: { softwareId: m365.id, name: 'M365 E3 annual', licenseType: 'SUBSCRIPTION', seats: 50, vendorId: vendor.microsoft.id, startDate: dateOnly(daysFromNow(-340)), expiryDate: dateOnly(daysFromNow(25)), cost: 21600, currency: 'USD' } });
    const acroLic = await prisma.softwareLicense.create({ data: { softwareId: acrobat.id, name: 'Acrobat Pro team', licenseType: 'SUBSCRIPTION', seats: 3, vendorId: vendor.adobe.id, startDate: dateOnly(daysFromNow(-100)), expiryDate: dateOnly(daysFromNow(265)), cost: 720, currency: 'USD' } });
    const winLic = await prisma.softwareLicense.create({ data: { softwareId: win.id, name: 'Windows OEM', licenseType: 'OEM', seats: null } });
    for (const e of ['E1001', 'E1002', 'E1003', 'E1004', 'E1005', 'E1006', 'E1007', 'E1008', 'E1009', 'E1010']) {
      await prisma.softwareAssignment.create({ data: { licenseId: m365Lic.id, employeeId: emp[e].id, assignedById: admin.id } });
    }
    for (const e of ['E1003', 'E1004', 'E1005']) {
      await prisma.softwareAssignment.create({ data: { licenseId: acroLic.id, employeeId: emp[e].id, assignedById: admin.id } });
    }
    for (const key of ['L1', 'L2', 'L3', 'D1', 'D2']) {
      await prisma.softwareAssignment.create({ data: { licenseId: winLic.id, assetId: created[key], assignedById: admin.id } });
    }

    // ── Tickets ─────────────────────────────────────────────────────────────
    const t1 = await prisma.ticket.create({ data: { title: 'Laptop fan very loud', description: 'Fan runs at full speed even when idle.', category: 'HARDWARE', priority: 'MEDIUM', status: 'IN_PROGRESS', requesterId: emp.E1004.id, createdById: userIds[ROLES.EMPLOYEE], assigneeId: tech, assetId: created.L2 } });
    await prisma.ticketComment.create({ data: { ticketId: t1.id, authorId: tech, body: 'Scheduled a clean-out for Thursday morning.' } });
    await prisma.ticketComment.create({ data: { ticketId: t1.id, authorId: tech, body: 'Check BIOS fan profile first.', isInternal: true } });
    await prisma.ticket.create({ data: { title: 'VPN access for new hire', description: 'Please enable VPN for Fatima Ali.', category: 'ACCESS', priority: 'HIGH', status: 'OPEN', requesterId: emp.E1006.id, createdById: admin.id } });
    await prisma.ticket.create({ data: { title: 'Request second monitor', description: 'Would like a second 27" monitor.', category: 'ASSET_REQUEST', priority: 'LOW', status: 'OPEN', requesterId: emp.E1003.id, createdById: userIds[ROLES.DEPARTMENT_MANAGER] } });
    await prisma.ticket.create({ data: { title: 'Printer paper jam', description: 'Floor 2 printer jams on duplex.', category: 'HARDWARE', priority: 'LOW', status: 'RESOLVED', requesterId: emp.E1005.id, createdById: admin.id, assigneeId: tech, resolution: 'Replaced pickup roller.', resolvedAt: daysFromNow(-2), assetId: created.PR1 } });

    // ── Audits ──────────────────────────────────────────────────────────────
    await prisma.auditSession.create({ data: { name: 'Q4 Head Office audit', locationId: hq.id, scheduledAt: daysFromNow(14), createdById: admin.id } });
    await prisma.auditSession.create({ data: { name: 'Store room spot check', locationId: loc.WH.id, createdById: admin.id, notes: 'Start this audit and scan the store room assets.' } });

    // ── Alerts ──────────────────────────────────────────────────────────────
    const alerts = await app.get(AlertsScheduler).runAll();

    console.log('\nDemo data loaded.');
    console.log(`  ${assetSpecs.length} assets, ${people.length} employees, 5 departments, 6 locations, alerts: ${JSON.stringify(alerts)}`);
    console.log('\nDemo accounts (local only — change or delete before sharing this environment):');
    for (const [email, name, role] of users) console.log(`  ${role.padEnd(20)} ${email.padEnd(26)} ${name}`);
    console.log(`  Password for all demo accounts: ${demoPassword}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
