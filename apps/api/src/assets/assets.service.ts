import { Injectable } from '@nestjs/common';
import { AssetStatus, Prisma } from '@prisma/client';
import { canTransition, WORKFLOW_ONLY_STATUSES } from '@itam/shared';
import { ActivityLogService, diff, type Db } from '../activity-logs/activity-log.service';
import { can, dataScope, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import { addDays, paginate, resolveOrderBy, searchFilter, startOfDay } from '../common/query/list-query';
import { documentSelect } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  allowedAssetActions,
  assetScopeWhere,
  employeeSummarySelect,
} from './asset-access';
import { AssetHistoryService } from './asset-history.service';
import type {
  AssetQueryDto,
  CreateAssetDto,
  DisposeAssetDto,
  ReportLostDto,
  RetireAssetDto,
  UpdateAssetDto,
} from './assets.dto';

export const OPEN_MAINTENANCE: Prisma.MaintenanceWhereInput = { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } };

const listSelect = {
  id: true,
  assetTag: true,
  name: true,
  serialNumber: true,
  brand: true,
  model: true,
  status: true,
  condition: true,
  purchaseDate: true,
  purchaseCost: true,
  currency: true,
  warrantyEndDate: true,
  createdAt: true,
  assetType: { select: { id: true, name: true, category: true } },
  location: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  assignments: {
    where: { status: 'ACTIVE' },
    take: 1,
    select: {
      id: true,
      assignedAt: true,
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      location: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.AssetSelect;

const detailInclude = {
  assetType: true,
  location: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
  purchase: { select: { id: true, orderNumber: true, invoiceNumber: true, purchaseDate: true } },
  vendor: { select: { id: true, name: true } },
  warrantyProvider: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  updatedBy: { select: { id: true, displayName: true } },
  assignments: {
    where: { status: 'ACTIVE' },
    take: 1,
    include: {
      employee: { select: employeeSummarySelect },
      location: { select: { id: true, name: true } },
      assignedBy: { select: { id: true, displayName: true } },
      accessoryAssignments: {
        where: { status: 'ACTIVE' },
        include: { accessory: { select: { id: true, name: true, category: true } } },
      },
    },
  },
  maintenance: { where: OPEN_MAINTENANCE, take: 1, orderBy: { createdAt: 'desc' } },
  _count: { select: { assignments: true, maintenance: true, documents: { where: { deletedAt: null } } } },
} satisfies Prisma.AssetInclude;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  scopeOrThrow(user: AuthUser): Prisma.AssetWhereInput {
    const scope = assetScopeWhere(user);
    if (!scope) throw Errors.forbidden();
    return scope;
  }

  async list(q: AssetQueryDto, user: AuthUser) {
    const today = startOfDay();
    const warrantyDays = q.warrantyDays ?? (await this.settings.get()).warrantyAlertDays;
    const warrantyWhere: Record<string, Prisma.AssetWhereInput> = {
      active: { warrantyEndDate: { gte: today } },
      expiring: { warrantyEndDate: { gte: today, lte: addDays(today, warrantyDays) } },
      expired: { warrantyEndDate: { lt: today } },
      none: { warrantyEndDate: null },
    };
    const where: Prisma.AssetWhereInput = {
      AND: [
        this.scopeOrThrow(user),
        { deletedAt: null },
        q.status?.length ? { status: { in: q.status } } : {},
        q.assetTypeId ? { assetTypeId: q.assetTypeId } : {},
        q.category ? { assetType: { category: q.category } } : {},
        q.locationId ? { locationId: q.locationId } : {},
        q.departmentId ? { departmentId: q.departmentId } : {},
        q.purchaseId ? { purchaseId: q.purchaseId } : {},
        q.employeeId ? { assignments: { some: { status: 'ACTIVE', employeeId: q.employeeId } } } : {},
        q.warranty ? warrantyWhere[q.warranty] : {},
        q.search
          ? { OR: searchFilter(q.search, ['assetTag', 'name', 'serialNumber', 'serviceTag', 'brand', 'model']) }
          : {},
      ],
    };
    const orderBy = resolveOrderBy<Prisma.AssetOrderByWithRelationInput>(
      q,
      {
        assetTag: (o) => ({ assetTag: o }),
        name: (o) => ({ name: o }),
        status: (o) => ({ status: o }),
        createdAt: (o) => ({ createdAt: o }),
        purchaseDate: (o) => ({ purchaseDate: { sort: o, nulls: 'last' } }),
        warrantyEndDate: (o) => ({ warrantyEndDate: { sort: o, nulls: 'last' } }),
      },
      { createdAt: 'desc' },
    );
    return paginate(
      q,
      (page) => this.prisma.asset.findMany({ where, select: listSelect, orderBy, ...page }),
      () => this.prisma.asset.count({ where }),
    );
  }

  /** Load an asset the user is allowed to see (404 otherwise — never reveal out-of-scope records). */
  async findVisible(id: string, user: AuthUser) {
    const asset = await this.prisma.asset.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeOrThrow(user)] },
      include: detailInclude,
    });
    if (!asset) throw Errors.notFound('Asset');
    return asset;
  }

  async get(id: string, user: AuthUser) {
    const asset = await this.findVisible(id, user);
    const { assignments, maintenance, ...rest } = asset;
    const currentAssignment = assignments[0] ?? null;
    const auditInProgress = can(user, 'audit.perform')
      ? (await this.prisma.auditSession.count({ where: { status: 'IN_PROGRESS' } })) > 0
      : false;
    return {
      ...rest,
      currentAssignment,
      openMaintenance: maintenance[0] ?? null,
      allowedActions: allowedAssetActions(user, {
        status: asset.status,
        activeAssignment: currentAssignment,
        hasOpenMaintenance: maintenance.length > 0,
        auditInProgress,
      }),
    };
  }

  async create(dto: CreateAssetDto, user: AuthUser) {
    await this.assertReferences(dto);
    this.assertWarrantyDates(dto.warrantyStartDate, dto.warrantyEndDate);
    const settings = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      const assetTag = dto.assetTag ?? (await this.nextAssetTag(tx, settings.assetTagPrefix));
      const asset = await tx.asset.create({
        data: {
          ...dto,
          assetTag,
          status: dto.status ?? 'IN_STOCK',
          currency: dto.purchaseCost !== undefined ? (dto.currency ?? settings.defaultCurrency) : dto.currency,
          specifications: dto.specifications as Prisma.InputJsonValue | undefined,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await this.history.record(tx, {
        assetId: asset.id,
        action: 'CREATED',
        toStatus: asset.status,
        toLocationId: asset.locationId,
        performedById: user.id,
        description: `Registered ${asset.assetTag}`,
      });
      await this.activity.record(
        { actorId: user.id, action: 'asset.create', entityType: 'asset', entityId: asset.id, newValues: dto },
        tx,
      );
      return asset;
    });
  }

  async update(id: string, dto: UpdateAssetDto, user: AuthUser) {
    const existing = await this.findVisible(id, user);
    if (existing.status === 'DISPOSED') throw Errors.invalidState('Disposed assets cannot be edited');
    await this.assertReferences(dto);
    this.assertWarrantyDates(
      dto.warrantyStartDate ?? existing.warrantyStartDate ?? undefined,
      dto.warrantyEndDate ?? existing.warrantyEndDate ?? undefined,
    );

    if (dto.status && dto.status !== existing.status) {
      if (WORKFLOW_ONLY_STATUSES.includes(dto.status) || !canTransition(existing.status, dto.status)) {
        throw Errors.invalidState(`Cannot change status from ${existing.status} to ${dto.status} directly`);
      }
      if (existing.assignments.length) throw Errors.invalidState('Return the asset before changing its status');
    }

    const { assignments: _a, maintenance: _m, _count, assetType, location, department, purchase, vendor, warrantyProvider, createdBy, updatedBy, ...before } = existing;
    const changes = diff(before as Record<string, unknown>, dto as Record<string, unknown>);
    if (!changes) return this.get(id, user);

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          ...dto,
          specifications: dto.specifications as Prisma.InputJsonValue | undefined,
          updatedById: user.id,
        },
      });
      if (dto.status && dto.status !== existing.status) {
        await this.history.record(tx, {
          assetId: id,
          action: 'STATUS_CHANGED',
          fromStatus: existing.status,
          toStatus: dto.status,
          performedById: user.id,
        });
      }
      if (dto.locationId !== undefined && dto.locationId !== existing.locationId) {
        await this.history.record(tx, {
          assetId: id,
          action: 'LOCATION_CHANGED',
          fromLocationId: existing.locationId,
          toLocationId: dto.locationId,
          performedById: user.id,
        });
      }
      const otherFields = Object.keys(changes.newValues).filter((k) => k !== 'status' && k !== 'locationId');
      if (otherFields.length) {
        await this.history.record(tx, {
          assetId: id,
          action: 'UPDATED',
          performedById: user.id,
          description: `Updated ${otherFields.join(', ')}`,
          metadata: { fields: otherFields },
        });
      }
      await this.activity.record(
        { actorId: user.id, action: 'asset.update', entityType: 'asset', entityId: id, ...changes },
        tx,
      );
    });
    return this.get(id, user);
  }

  /** Soft delete — only for assets that are not in use. Prefer retire/dispose for end of life. */
  async remove(id: string, user: AuthUser) {
    const asset = await this.findVisible(id, user);
    if (asset.assignments.length || asset.maintenance.length || asset.status === 'ASSIGNED' || asset.status === 'IN_REPAIR') {
      throw Errors.invalidState('Assets that are assigned or under maintenance cannot be deleted');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
      await this.history.record(tx, {
        assetId: id,
        action: 'UPDATED',
        performedById: user.id,
        description: 'Deleted (archived)',
      });
      await this.activity.record(
        { actorId: user.id, action: 'asset.delete', entityType: 'asset', entityId: id, oldValues: { assetTag: asset.assetTag, status: asset.status } },
        tx,
      );
    });
    return { id, deleted: true };
  }

  async historyFor(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    return this.prisma.assetHistory.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        performedBy: { select: { id: true, displayName: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
      },
    });
  }

  async assignments(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    return this.prisma.assetAssignment.findMany({
      where: { assetId: id },
      orderBy: { assignedAt: 'desc' },
      include: {
        employee: { select: employeeSummarySelect },
        location: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, displayName: true } },
        returnedBy: { select: { id: true, displayName: true } },
        accessoryAssignments: { include: { accessory: { select: { id: true, name: true } } } },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
  }

  async maintenance(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    return this.prisma.maintenance.findMany({
      where: { assetId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        technician: { select: { id: true, displayName: true } },
        vendor: { select: { id: true, name: true } },
      },
    });
  }

  async documents(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    return this.prisma.document.findMany({
      where: {
        deletedAt: null,
        OR: [{ assetId: id }, { assignment: { assetId: id } }, { maintenance: { assetId: id } }],
      },
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async software(id: string, user: AuthUser) {
    await this.findVisible(id, user);
    return this.prisma.softwareAssignment.findMany({
      where: { assetId: id, unassignedAt: null },
      include: {
        license: {
          select: {
            id: true,
            name: true,
            licenseType: true,
            expiryDate: true,
            software: { select: { id: true, name: true, version: true } },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async retire(id: string, dto: RetireAssetDto, user: AuthUser) {
    const asset = await this.findVisible(id, user);
    if (asset.assignments.length) throw Errors.invalidState('Return the asset before retiring it');
    if (asset.maintenance.length) throw Errors.invalidState('Complete or cancel open maintenance first');
    this.assertTransition(asset.status, 'RETIRED');
    await this.prisma.$transaction(async (tx) => {
      await this.setStatus(tx, id, asset.status, 'RETIRED', { retiredAt: new Date(), updatedById: user.id });
      await this.history.record(tx, {
        assetId: id,
        action: 'RETIRED',
        fromStatus: asset.status,
        toStatus: 'RETIRED',
        performedById: user.id,
        description: dto.reason,
      });
      await this.activity.record(
        { actorId: user.id, action: 'asset.retire', entityType: 'asset', entityId: id, oldValues: { status: asset.status }, newValues: { status: 'RETIRED', reason: dto.reason } },
        tx,
      );
    });
    return this.get(id, user);
  }

  async dispose(id: string, dto: DisposeAssetDto, user: AuthUser) {
    const asset = await this.findVisible(id, user);
    this.assertTransition(asset.status, 'DISPOSED');
    await this.prisma.$transaction(async (tx) => {
      await this.setStatus(tx, id, asset.status, 'DISPOSED', {
        disposedAt: dto.disposedAt ?? new Date(),
        disposalMethod: dto.method,
        disposalReason: dto.reason,
        updatedById: user.id,
      });
      await this.history.record(tx, {
        assetId: id,
        action: 'DISPOSED',
        fromStatus: asset.status,
        toStatus: 'DISPOSED',
        performedById: user.id,
        description: `${dto.method}: ${dto.reason}`,
      });
      await this.activity.record(
        { actorId: user.id, action: 'asset.dispose', entityType: 'asset', entityId: id, oldValues: { status: asset.status }, newValues: { status: 'DISPOSED', ...dto } },
        tx,
      );
    });
    return this.get(id, user);
  }

  async reportLost(id: string, dto: ReportLostDto, user: AuthUser) {
    const asset = await this.findVisible(id, user);
    const active = asset.assignments[0];
    if (dataScope(user, 'asset') !== 'all' && (!user.employeeId || active?.employeeId !== user.employeeId)) {
      throw Errors.forbidden('You can only report assets assigned to you as lost');
    }
    this.assertTransition(asset.status, 'LOST');

    const ticket = await this.prisma.$transaction(async (tx) => {
      if (active) {
        await tx.assetAssignment.update({
          where: { id: active.id },
          data: { status: 'RETURNED', returnedAt: new Date(), returnedById: user.id, returnNotes: `Reported lost: ${dto.notes}` },
        });
        await tx.accessoryAssignment.updateMany({
          where: { assetAssignmentId: active.id, status: 'ACTIVE' },
          data: { status: 'RETURNED', returnedAt: new Date(), returnedById: user.id, notes: 'Reported lost with asset' },
        });
      }
      await tx.maintenance.updateMany({
        where: { assetId: id, ...OPEN_MAINTENANCE },
        data: { status: 'CANCELLED', cancelledAt: new Date(), resolutionNotes: 'Cancelled: asset reported lost' },
      });
      await this.setStatus(tx, id, asset.status, 'LOST', { lostAt: new Date(), updatedById: user.id });
      await this.history.record(tx, {
        assetId: id,
        action: 'REPORTED_LOST',
        fromStatus: asset.status,
        toStatus: 'LOST',
        assignmentId: active?.id,
        performedById: user.id,
        description: dto.notes,
      });
      const created = await tx.ticket.create({
        data: {
          title: `Lost asset: ${asset.assetTag} ${asset.name}`.slice(0, 200),
          description: dto.notes,
          category: 'LOSS_REPORT',
          priority: 'HIGH',
          requesterId: active?.employeeId ?? user.employeeId,
          createdById: user.id,
          assetId: id,
        },
      });
      await this.activity.record(
        { actorId: user.id, action: 'asset.report_lost', entityType: 'asset', entityId: id, oldValues: { status: asset.status }, newValues: { status: 'LOST', notes: dto.notes, ticketId: created.id } },
        tx,
      );
      return created;
    });
    return { asset: await this.prisma.asset.findUniqueOrThrow({ where: { id } }), ticketId: ticket.id, ticketNumber: ticket.number };
  }

  /** Conditional status update — fails if another request changed the status first. */
  async setStatus(db: Db, id: string, from: AssetStatus, to: AssetStatus, data: Prisma.AssetUncheckedUpdateManyInput = {}) {
    const result = await db.asset.updateMany({ where: { id, status: from, deletedAt: null }, data: { ...data, status: to } });
    if (result.count !== 1) throw Errors.conflict('CONCURRENT_UPDATE', 'The asset was changed by someone else. Reload and try again.');
  }

  assertTransition(from: AssetStatus, to: AssetStatus): void {
    if (!canTransition(from, to)) throw Errors.invalidState(`An asset that is ${from} cannot become ${to}`);
  }

  async nextAssetTag(db: Db, prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [{ nextval }] = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('asset_tag_seq')`;
      const tag = `${prefix}-${String(nextval).padStart(6, '0')}`;
      if (!(await db.asset.findUnique({ where: { assetTag: tag }, select: { id: true } }))) return tag;
    }
    throw Errors.conflict('ASSET_TAG_EXHAUSTED', 'Could not generate a unique asset tag');
  }

  private assertWarrantyDates(start?: Date, end?: Date): void {
    if (start && end && end < start) throw Errors.badRequest('Warranty end date must be after the start date', 'warrantyEndDate');
  }

  private async assertReferences(dto: Partial<Omit<CreateAssetDto, 'status'>>): Promise<void> {
    const checks: [string, keyof Omit<CreateAssetDto, 'status'>, (id: string) => Promise<unknown>][] = [
      ['Asset type', 'assetTypeId', (id) => this.prisma.assetType.findFirst({ where: { id, isActive: true } })],
      ['Location', 'locationId', (id) => this.prisma.location.findFirst({ where: { id, deletedAt: null } })],
      ['Department', 'departmentId', (id) => this.prisma.department.findFirst({ where: { id, deletedAt: null } })],
      ['Purchase', 'purchaseId', (id) => this.prisma.purchase.findFirst({ where: { id, deletedAt: null } })],
      ['Vendor', 'vendorId', (id) => this.prisma.vendor.findFirst({ where: { id, deletedAt: null } })],
      ['Warranty provider', 'warrantyProviderId', (id) => this.prisma.vendor.findFirst({ where: { id, deletedAt: null } })],
    ];
    for (const [name, field, find] of checks) {
      const id = dto[field] as string | undefined;
      if (id && !(await find(id))) throw Errors.badRequest(`${name} not found`, field);
    }
  }
}
