import { Injectable } from '@nestjs/common';
import { AssetStatus, Prisma } from '@prisma/client';
import { ASSET_STATUSES, label, type PermissionKey } from '@itam/shared';
import { assetScopeWhere } from '../assets/asset-access';
import { can, dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import { addDays, startOfDay } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { CellValue, ReportColumn, ReportResult } from './report-renderers';

export const REPORT_TYPES = [
  'assets',
  'assignments',
  'purchases',
  'maintenance',
  'warranty',
  'software',
  'audit',
  'departments',
  'locations',
  'lifecycle',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportFilters {
  status?: string;
  from?: Date;
  to?: Date;
  locationId?: string;
  departmentId?: string;
  assetTypeId?: string;
  vendorId?: string;
  employeeId?: string;
  auditId?: string;
  assetId?: string;
  days?: number;
}

const MAX_ROWS = 20_000;
const num = (v: Prisma.Decimal | number | null | undefined) =>
  v === null || v === undefined ? null : Number(v);
const fullName = (e?: { firstName: string; lastName: string } | null) =>
  e ? `${e.firstName} ${e.lastName}` : null;

interface Definition {
  title: string;
  permissions: PermissionKey[];
  columns: ReportColumn[];
  build: (
    f: ReportFilters,
    user: AuthUser,
    take: number,
  ) => Promise<{ rows: Record<string, CellValue>[]; total: number }>;
}

@Injectable()
export class ReportsService {
  private readonly definitions: Record<ReportType, Definition>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {
    this.definitions = {
      assets: {
        title: 'Asset inventory',
        permissions: ['asset.view', 'asset.view_department'],
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'name', label: 'Name', width: 1.6 },
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'condition', label: 'Condition', width: 0.8 },
          { key: 'serialNumber', label: 'Serial number' },
          { key: 'brandModel', label: 'Brand / model', width: 1.4 },
          { key: 'location', label: 'Location' },
          { key: 'department', label: 'Department' },
          { key: 'assignedTo', label: 'Assigned to' },
          { key: 'purchaseDate', label: 'Purchased', type: 'date' },
          { key: 'purchaseCost', label: 'Cost', type: 'money', width: 0.8 },
          { key: 'currency', label: 'Cur.', width: 0.5 },
          { key: 'warrantyEndDate', label: 'Warranty end', type: 'date' },
        ],
        build: async (f, user, take) => {
          const { defaultCurrency } = await this.settings.get();
          const where = this.assetWhere(f, user);
          const [items, total] = await Promise.all([
            this.prisma.asset.findMany({
              where,
              take,
              orderBy: { assetTag: 'asc' },
              include: {
                assetType: true,
                location: true,
                department: true,
                assignments: {
                  where: { status: 'ACTIVE' },
                  include: { employee: true, location: true },
                },
              },
            }),
            this.prisma.asset.count({ where }),
          ]);
          return {
            total,
            rows: items.map((a) => ({
              assetTag: a.assetTag,
              name: a.name,
              type: a.assetType.name,
              status: label('assetStatus', a.status),
              condition: label('assetCondition', a.condition),
              serialNumber: a.serialNumber,
              brandModel: [a.brand, a.model].filter(Boolean).join(' '),
              location: a.location?.name,
              department: a.department?.name,
              assignedTo: fullName(a.assignments[0]?.employee) ?? a.assignments[0]?.location?.name,
              purchaseDate: a.purchaseDate,
              purchaseCost: num(a.purchaseCost),
              currency: a.currency ?? defaultCurrency,
              warrantyEndDate: a.warrantyEndDate,
            })),
          };
        },
      },

      assignments: {
        title: 'Assignment history',
        permissions: ['asset.view', 'asset.view_department'],
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'assetName', label: 'Asset', width: 1.4 },
          { key: 'employee', label: 'Employee' },
          { key: 'employeeNumber', label: 'Emp. no.', width: 0.8 },
          { key: 'department', label: 'Department' },
          { key: 'location', label: 'Location' },
          { key: 'status', label: 'Status', width: 0.8 },
          { key: 'assignedAt', label: 'Assigned', type: 'datetime' },
          { key: 'expectedReturnAt', label: 'Due back', type: 'date' },
          { key: 'returnedAt', label: 'Returned', type: 'datetime' },
          { key: 'conditionOut', label: 'Cond. out', width: 0.8 },
          { key: 'conditionIn', label: 'Cond. in', width: 0.8 },
          { key: 'acknowledged', label: 'Ack.', width: 0.5 },
        ],
        build: async (f, user, take) => {
          const scope = dataScope(user, 'asset');
          const where: Prisma.AssetAssignmentWhereInput = {
            status: f.status as Prisma.AssetAssignmentWhereInput['status'],
            employeeId: f.employeeId,
            assetId: f.assetId,
            assignedAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
            employee: f.departmentId ? { departmentId: f.departmentId } : undefined,
            AND:
              scope === 'department'
                ? [
                    {
                      OR: [
                        { employee: { departmentId: user.departmentId ?? NO_MATCH_ID } },
                        { asset: { departmentId: user.departmentId ?? NO_MATCH_ID } },
                      ],
                    },
                  ]
                : undefined,
          };
          const [items, total] = await Promise.all([
            this.prisma.assetAssignment.findMany({
              where,
              take,
              orderBy: { assignedAt: 'desc' },
              include: { asset: true, employee: { include: { department: true } }, location: true },
            }),
            this.prisma.assetAssignment.count({ where }),
          ]);
          return {
            total,
            rows: items.map((a) => ({
              assetTag: a.asset.assetTag,
              assetName: a.asset.name,
              employee: fullName(a.employee),
              employeeNumber: a.employee?.employeeNumber,
              department: a.employee?.department?.name,
              location: a.location?.name,
              status: label('assignmentStatus', a.status),
              assignedAt: a.assignedAt,
              expectedReturnAt: a.expectedReturnAt,
              returnedAt: a.returnedAt,
              conditionOut: label('assetCondition', a.conditionAtAssignment),
              conditionIn: a.conditionAtReturn
                ? label('assetCondition', a.conditionAtReturn)
                : null,
              acknowledged: !!a.acknowledgedAt,
            })),
          };
        },
      },

      purchases: {
        title: 'Purchases',
        permissions: ['purchase.view'],
        columns: [
          { key: 'orderNumber', label: 'Order no.' },
          { key: 'invoiceNumber', label: 'Invoice no.' },
          { key: 'vendor', label: 'Vendor', width: 1.5 },
          { key: 'purchaseDate', label: 'Date', type: 'date' },
          { key: 'currency', label: 'Cur.', width: 0.5 },
          { key: 'subtotal', label: 'Subtotal', type: 'money' },
          { key: 'taxAmount', label: 'Tax', type: 'money' },
          { key: 'totalAmount', label: 'Total', type: 'money' },
          { key: 'assets', label: 'Assets', type: 'number', width: 0.6 },
        ],
        build: async (f, _user, take) => {
          const { defaultCurrency } = await this.settings.get();
          const where: Prisma.PurchaseWhereInput = {
            deletedAt: null,
            vendorId: f.vendorId,
            purchaseDate: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
          };
          const [items, total] = await Promise.all([
            this.prisma.purchase.findMany({
              where,
              take,
              orderBy: { purchaseDate: 'desc' },
              include: { vendor: true, _count: { select: { assets: true } } },
            }),
            this.prisma.purchase.count({ where }),
          ]);
          return {
            total,
            rows: items.map((p) => ({
              orderNumber: p.orderNumber,
              invoiceNumber: p.invoiceNumber,
              vendor: p.vendor.name,
              purchaseDate: p.purchaseDate,
              currency: p.currency ?? defaultCurrency,
              subtotal: num(p.subtotal),
              taxAmount: num(p.taxAmount),
              totalAmount: num(p.totalAmount),
              assets: p._count.assets,
            })),
          };
        },
      },

      maintenance: {
        title: 'Maintenance & repairs',
        permissions: ['maintenance.view'],
        columns: [
          { key: 'ref', label: 'Ref', width: 0.7 },
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'title', label: 'Title', width: 1.6 },
          { key: 'type', label: 'Type', width: 0.8 },
          { key: 'priority', label: 'Priority', width: 0.7 },
          { key: 'status', label: 'Status', width: 0.8 },
          { key: 'technician', label: 'Technician' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'startedAt', label: 'Started', type: 'date' },
          { key: 'completedAt', label: 'Completed', type: 'date' },
          { key: 'totalCost', label: 'Total cost', type: 'money' },
          { key: 'currency', label: 'Cur.', width: 0.5 },
          { key: 'warrantyClaim', label: 'Warranty', width: 0.6 },
        ],
        build: async (f, _user, take) => {
          const { defaultCurrency } = await this.settings.get();
          const where: Prisma.MaintenanceWhereInput = {
            status: f.status as Prisma.MaintenanceWhereInput['status'],
            vendorId: f.vendorId,
            assetId: f.assetId,
            createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
          };
          const [items, total] = await Promise.all([
            this.prisma.maintenance.findMany({
              where,
              take,
              orderBy: { createdAt: 'desc' },
              include: { asset: true, technician: true, vendor: true },
            }),
            this.prisma.maintenance.count({ where }),
          ]);
          return {
            total,
            rows: items.map((m) => ({
              ref: `MNT-${m.number}`,
              assetTag: m.asset.assetTag,
              title: m.title,
              type: label('maintenanceType', m.type),
              priority: label('priority', m.priority),
              status: label('maintenanceStatus', m.status),
              technician: m.technician?.displayName,
              vendor: m.vendor?.name,
              startedAt: m.startedAt,
              completedAt: m.completedAt,
              totalCost: num(m.totalCost),
              currency: m.currency ?? defaultCurrency,
              warrantyClaim: m.isWarrantyClaim,
            })),
          };
        },
      },

      warranty: {
        title: 'Warranty status',
        permissions: ['warranty.view', 'asset.view_department'],
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'name', label: 'Asset', width: 1.6 },
          { key: 'serialNumber', label: 'Serial number' },
          { key: 'provider', label: 'Provider' },
          { key: 'reference', label: 'Reference' },
          { key: 'startDate', label: 'Start', type: 'date' },
          { key: 'endDate', label: 'End', type: 'date' },
          { key: 'daysRemaining', label: 'Days left', type: 'number', width: 0.7 },
          { key: 'state', label: 'State', width: 0.8 },
        ],
        build: async (f, user, take) => {
          const today = startOfDay();
          const where: Prisma.AssetWhereInput = {
            AND: [
              this.assetWhere({ ...f, status: undefined }, user),
              {
                warrantyEndDate: f.days
                  ? { gte: today, lte: addDays(today, f.days) }
                  : { not: null },
              },
            ],
          };
          const [items, total] = await Promise.all([
            this.prisma.asset.findMany({
              where,
              take,
              orderBy: { warrantyEndDate: 'asc' },
              include: { warrantyProvider: true },
            }),
            this.prisma.asset.count({ where }),
          ]);
          const { warrantyAlertDays } = await this.settings.get();
          return {
            total,
            rows: items.map((a) => {
              const days = Math.ceil((a.warrantyEndDate!.getTime() - today.getTime()) / 86_400_000);
              return {
                assetTag: a.assetTag,
                name: a.name,
                serialNumber: a.serialNumber,
                provider: a.warrantyProvider?.name,
                reference: a.warrantyReference,
                startDate: a.warrantyStartDate,
                endDate: a.warrantyEndDate,
                daysRemaining: days,
                state: days < 0 ? 'Expired' : days <= warrantyAlertDays ? 'Expiring' : 'Active',
              };
            }),
          };
        },
      },

      software: {
        title: 'Software licences & utilisation',
        permissions: ['license.view'],
        columns: [
          { key: 'software', label: 'Software', width: 1.5 },
          { key: 'license', label: 'Licence', width: 1.3 },
          { key: 'type', label: 'Type', width: 0.9 },
          { key: 'seats', label: 'Seats', type: 'number', width: 0.6 },
          { key: 'used', label: 'Used', type: 'number', width: 0.6 },
          { key: 'available', label: 'Free', type: 'number', width: 0.6 },
          { key: 'utilization', label: 'Util. %', type: 'number', width: 0.6 },
          { key: 'expiryDate', label: 'Expires', type: 'date' },
          { key: 'vendor', label: 'Vendor' },
          { key: 'cost', label: 'Cost', type: 'money', width: 0.8 },
          { key: 'currency', label: 'Cur.', width: 0.5 },
        ],
        build: async (f, _user, take) => {
          const { defaultCurrency } = await this.settings.get();
          const where: Prisma.SoftwareLicenseWhereInput = {
            deletedAt: null,
            vendorId: f.vendorId,
            expiryDate: f.days
              ? { gte: startOfDay(), lte: addDays(startOfDay(), f.days) }
              : undefined,
          };
          const [items, total] = await Promise.all([
            this.prisma.softwareLicense.findMany({
              where,
              take,
              orderBy: [{ software: { name: 'asc' } }, { expiryDate: 'asc' }],
              include: {
                software: true,
                vendor: true,
                _count: { select: { assignments: { where: { unassignedAt: null } } } },
              },
            }),
            this.prisma.softwareLicense.count({ where }),
          ]);
          return {
            total,
            rows: items.map((l) => ({
              software: [l.software.name, l.software.version].filter(Boolean).join(' '),
              license: l.name,
              type: label('licenseType', l.licenseType),
              seats: l.seats,
              used: l._count.assignments,
              available: l.seats === null ? null : Math.max(l.seats - l._count.assignments, 0),
              utilization: l.seats ? Math.round((l._count.assignments / l.seats) * 100) : null,
              expiryDate: l.expiryDate,
              vendor: l.vendor?.name,
              cost: num(l.cost),
              currency: l.currency ?? defaultCurrency,
            })),
          };
        },
      },

      audit: {
        title: 'Inventory audit',
        permissions: ['audit.view'],
        columns: [
          { key: 'assetTag', label: 'Asset tag / code' },
          { key: 'name', label: 'Asset', width: 1.5 },
          { key: 'expected', label: 'Expected', width: 0.7 },
          { key: 'result', label: 'Result' },
          { key: 'expectedLocation', label: 'Expected location' },
          { key: 'observedLocation', label: 'Observed location' },
          { key: 'condition', label: 'Condition', width: 0.8 },
          { key: 'scannedAt', label: 'Scanned', type: 'datetime' },
          { key: 'scannedBy', label: 'Scanned by' },
          { key: 'resolution', label: 'Resolution', width: 1.5 },
        ],
        build: async (f, _user, take) => {
          if (!f.auditId)
            throw Errors.badRequest('auditId is required for the audit report', 'auditId');
          const session = await this.prisma.auditSession.findUnique({ where: { id: f.auditId } });
          if (!session) throw Errors.notFound('Audit');
          const where: Prisma.AuditItemWhereInput = {
            auditSessionId: f.auditId,
            result: f.status as Prisma.AuditItemWhereInput['result'],
          };
          const [items, total] = await Promise.all([
            this.prisma.auditItem.findMany({
              where,
              take,
              orderBy: [{ result: 'asc' }, { createdAt: 'asc' }],
              include: {
                asset: true,
                expectedLocation: true,
                observedLocation: true,
                scannedBy: true,
              },
            }),
            this.prisma.auditItem.count({ where }),
          ]);
          return {
            total,
            rows: items.map((i) => ({
              assetTag: i.asset?.assetTag ?? i.scannedCode,
              name: i.asset?.name ?? 'Unregistered code',
              expected: i.expected,
              result: label('auditResult', i.result),
              expectedLocation: i.expectedLocation?.name,
              observedLocation: i.observedLocation?.name,
              condition: i.observedCondition ? label('assetCondition', i.observedCondition) : null,
              scannedAt: i.scannedAt,
              scannedBy: i.scannedBy?.displayName,
              resolution: i.resolution,
            })),
          };
        },
      },

      departments: {
        title: 'Assets by department',
        permissions: ['asset.view', 'asset.view_department'],
        columns: [
          { key: 'department', label: 'Department', width: 1.5 },
          { key: 'employees', label: 'Employees', type: 'number', width: 0.8 },
          { key: 'assets', label: 'Assets', type: 'number', width: 0.7 },
          ...ASSET_STATUSES.map((s) => ({
            key: s,
            label: label('assetStatus', s),
            type: 'number' as const,
            width: 0.7,
          })),
          { key: 'value', label: 'Purchase value', type: 'money' },
        ],
        build: async (_f, user) => {
          const departments = await this.prisma.department.findMany({
            where: {
              deletedAt: null,
              id:
                dataScope(user, 'asset') === 'all' ? undefined : (user.departmentId ?? NO_MATCH_ID),
            },
            orderBy: { name: 'asc' },
            include: { _count: { select: { employees: { where: { deletedAt: null } } } } },
          });
          const grouped = await this.prisma.asset.groupBy({
            by: ['departmentId', 'status'],
            where: { deletedAt: null, departmentId: { in: departments.map((d) => d.id) } },
            _count: { _all: true },
            _sum: { purchaseCost: true },
          });
          return {
            total: departments.length,
            rows: departments.map((d) => {
              const row: Record<string, CellValue> = {
                department: d.name,
                employees: d._count.employees,
                assets: 0,
                value: 0,
              };
              for (const s of ASSET_STATUSES) row[s] = 0;
              for (const g of grouped.filter((x) => x.departmentId === d.id)) {
                row[g.status] = g._count._all;
                row.assets = (row.assets as number) + g._count._all;
                row.value = (row.value as number) + Number(g._sum.purchaseCost ?? 0);
              }
              return row;
            }),
          };
        },
      },

      locations: {
        title: 'Assets by location',
        permissions: ['asset.view'],
        columns: [
          { key: 'location', label: 'Location', width: 1.5 },
          { key: 'type', label: 'Type', width: 0.8 },
          { key: 'parent', label: 'Parent' },
          { key: 'assets', label: 'Assets', type: 'number', width: 0.7 },
          ...ASSET_STATUSES.map((s) => ({
            key: s,
            label: label('assetStatus', s),
            type: 'number' as const,
            width: 0.7,
          })),
        ],
        build: async () => {
          const locations = await this.prisma.location.findMany({
            where: { deletedAt: null },
            orderBy: { name: 'asc' },
            include: { parent: true },
          });
          const grouped = await this.prisma.asset.groupBy({
            by: ['locationId', 'status'],
            where: { deletedAt: null, locationId: { not: null } },
            _count: { _all: true },
          });
          return {
            total: locations.length,
            rows: locations.map((l) => {
              const row: Record<string, CellValue> = {
                location: l.name,
                type: label('locationType', l.type),
                parent: l.parent?.name,
                assets: 0,
              };
              for (const s of ASSET_STATUSES) row[s] = 0;
              for (const g of grouped.filter((x) => x.locationId === l.id)) {
                row[g.status] = g._count._all;
                row.assets = (row.assets as number) + g._count._all;
              }
              return row;
            }),
          };
        },
      },

      lifecycle: {
        title: 'Asset lifecycle events',
        permissions: ['asset.view'],
        columns: [
          { key: 'createdAt', label: 'Date', type: 'datetime' },
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'asset', label: 'Asset', width: 1.3 },
          { key: 'action', label: 'Event' },
          { key: 'fromStatus', label: 'From' },
          { key: 'toStatus', label: 'To' },
          { key: 'performedBy', label: 'By' },
          { key: 'description', label: 'Details', width: 2 },
        ],
        build: async (f, _user, take) => {
          const where: Prisma.AssetHistoryWhereInput = {
            assetId: f.assetId,
            createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
          };
          const [items, total] = await Promise.all([
            this.prisma.assetHistory.findMany({
              where,
              take,
              orderBy: { createdAt: 'desc' },
              include: { asset: true, performedBy: true },
            }),
            this.prisma.assetHistory.count({ where }),
          ]);
          return {
            total,
            rows: items.map((h) => ({
              createdAt: h.createdAt,
              assetTag: h.asset.assetTag,
              asset: h.asset.name,
              action: label('historyAction', h.action),
              fromStatus: h.fromStatus ? label('assetStatus', h.fromStatus) : null,
              toStatus: h.toStatus ? label('assetStatus', h.toStatus) : null,
              performedBy: h.performedBy?.displayName,
              description: h.description,
            })),
          };
        },
      },
    };
  }

  catalogue(user: AuthUser) {
    return REPORT_TYPES.filter((t) => can(user, ...this.definitions[t].permissions)).map(
      (type) => ({
        type,
        title: this.definitions[type].title,
        columns: this.definitions[type].columns,
      }),
    );
  }

  async run(
    type: ReportType,
    filters: ReportFilters,
    user: AuthUser,
    maxRows = MAX_ROWS,
  ): Promise<ReportResult> {
    const def = this.definitions[type];
    if (!can(user, ...def.permissions))
      throw Errors.forbidden('You do not have access to this report');
    const { rows, total } = await def.build(filters, user, maxRows);
    return {
      type,
      title: def.title,
      columns: def.columns,
      rows,
      total,
      truncated: total > rows.length,
      generatedAt: new Date().toISOString(),
      filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
    };
  }

  private assetWhere(f: ReportFilters, user: AuthUser): Prisma.AssetWhereInput {
    const scope = assetScopeWhere(user);
    if (!scope) throw Errors.forbidden();
    const statuses = f.status
      ?.split(',')
      .filter((s): s is AssetStatus => (ASSET_STATUSES as readonly string[]).includes(s));
    return {
      AND: [
        scope,
        {
          deletedAt: null,
          status: statuses?.length ? { in: statuses } : undefined,
          locationId: f.locationId,
          departmentId: f.departmentId,
          assetTypeId: f.assetTypeId,
          vendorId: f.vendorId,
          assignments: f.employeeId
            ? { some: { status: 'ACTIVE', employeeId: f.employeeId } }
            : undefined,
        },
      ],
    };
  }
}
