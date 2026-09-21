import { Injectable, Logger } from '@nestjs/common';
import { AssetCondition, Prisma } from '@prisma/client';
import { ASSIGNABLE_STATUSES } from '@itam/shared';
import { ActivityLogService, type Db } from '../activity-logs/activity-log.service';
import { employeeSummarySelect } from '../assets/asset-access';
import { AssetHistoryService } from '../assets/asset-history.service';
import { AssetsService } from '../assets/assets.service';
import { dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { DocumentsService, documentSelect } from '../documents/documents.service';
import { decodeSignature } from '../documents/file-validation';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcknowledgeDto,
  AssignAssetDto,
  AssignmentQueryDto,
  ReturnAssetDto,
  TransferAssetDto,
} from './assignments.dto';
import { HandoverPdfService } from './handover-pdf.service';

const assignmentInclude = {
  asset: {
    select: {
      id: true,
      assetTag: true,
      name: true,
      serialNumber: true,
      status: true,
      assetType: { select: { id: true, name: true, category: true } },
    },
  },
  employee: { select: employeeSummarySelect },
  location: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, displayName: true } },
  returnedBy: { select: { id: true, displayName: true } },
  accessoryAssignments: {
    include: { accessory: { select: { id: true, name: true, category: true } } },
  },
} satisfies Prisma.AssetAssignmentInclude;

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly handoverPdf: HandoverPdfService,
  ) {}

  private scopeWhere(user: AuthUser): Prisma.AssetAssignmentWhereInput {
    const scope = dataScope(user, 'asset');
    if (scope === 'all') return {};
    if (scope === 'department') {
      const departmentId = user.departmentId ?? NO_MATCH_ID;
      return { OR: [{ employee: { departmentId } }, { asset: { departmentId } }] };
    }
    if (scope === 'own') return { employeeId: user.employeeId ?? NO_MATCH_ID };
    throw Errors.forbidden();
  }

  list(q: AssignmentQueryDto, user: AuthUser) {
    const where: Prisma.AssetAssignmentWhereInput = {
      AND: [
        this.scopeWhere(user),
        {
          status: q.overdue ? 'ACTIVE' : q.status,
          employeeId: q.employeeId,
          assetId: q.assetId,
          locationId: q.locationId,
          expectedReturnAt: q.overdue ? { lt: new Date() } : undefined,
          acknowledgedAt: q.unacknowledged ? null : undefined,
        },
        q.search
          ? {
              OR: searchFilter(q.search, [
                'asset.assetTag',
                'asset.name',
                'employee.firstName',
                'employee.lastName',
                'employee.employeeNumber',
              ]),
            }
          : {},
      ],
    };
    const orderBy = resolveOrderBy<Prisma.AssetAssignmentOrderByWithRelationInput>(
      q,
      {
        assignedAt: (o) => ({ assignedAt: o }),
        returnedAt: (o) => ({ returnedAt: { sort: o, nulls: 'last' } }),
        expectedReturnAt: (o) => ({ expectedReturnAt: { sort: o, nulls: 'last' } }),
      },
      { assignedAt: 'desc' },
    );
    return paginate(
      q,
      (page) =>
        this.prisma.assetAssignment.findMany({
          where,
          include: assignmentInclude,
          orderBy,
          ...page,
        }),
      () => this.prisma.assetAssignment.count({ where }),
    );
  }

  async get(id: string, user: AuthUser) {
    const assignment = await this.prisma.assetAssignment.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: {
        ...assignmentInclude,
        previousAssignment: {
          include: { employee: { select: employeeSummarySelect }, location: true },
        },
        nextAssignment: {
          include: { employee: { select: employeeSummarySelect }, location: true },
        },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
    if (!assignment) throw Errors.notFound('Assignment');
    return assignment;
  }

  async assign(assetId: string, dto: AssignAssetDto, user: AuthUser) {
    const asset = await this.assets.findVisible(assetId, user);
    const target = await this.resolveTarget(dto.employeeId, dto.locationId);
    if (!ASSIGNABLE_STATUSES.includes(asset.status)) {
      throw Errors.invalidState(
        `Only assets that are In stock or Available can be assigned (current: ${asset.status})`,
      );
    }
    if (asset.assignments.length) throw Errors.invalidState('This asset is already assigned');
    if (asset.maintenance.length) throw Errors.invalidState('This asset has open maintenance');
    if (dto.accessories?.length && !target.employee) {
      throw Errors.badRequest('Accessories can only be handed to an employee', 'accessories');
    }
    const signature = this.parseSignature(dto.signature);
    const now = new Date();

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.assetAssignment.create({
        data: {
          assetId,
          employeeId: target.employee?.id,
          locationId: target.location?.id,
          conditionAtAssignment: dto.condition,
          expectedReturnAt: dto.expectedReturnAt,
          notes: dto.notes,
          assignedById: user.id,
          acknowledgedAt: signature ? now : null,
        },
      });
      for (const line of mergeLines(dto.accessories ?? [])) {
        await this.takeAccessory(tx, line.accessoryId, line.quantity);
        await tx.accessoryAssignment.create({
          data: {
            accessoryId: line.accessoryId,
            employeeId: target.employee!.id,
            assetAssignmentId: created.id,
            quantity: line.quantity,
            assignedById: user.id,
            conditionAtAssignment: dto.condition,
          },
        });
      }
      const newLocationId = target.location?.id ?? target.employee?.locationId ?? asset.locationId;
      await this.assets.setStatus(tx, assetId, asset.status, 'ASSIGNED', {
        condition: dto.condition,
        locationId: newLocationId,
        updatedById: user.id,
      });
      await this.history.record(tx, {
        assetId,
        action: 'ASSIGNED',
        fromStatus: asset.status,
        toStatus: 'ASSIGNED',
        fromLocationId: asset.locationId,
        toLocationId: newLocationId,
        assignmentId: created.id,
        performedById: user.id,
        description: `Assigned to ${target.label}`,
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'asset.assign',
          entityType: 'asset',
          entityId: assetId,
          oldValues: { status: asset.status },
          newValues: {
            status: 'ASSIGNED',
            assignmentId: created.id,
            employeeId: target.employee?.id,
            locationId: target.location?.id,
            accessories: dto.accessories,
          },
        },
        tx,
      );
      if (!signature && target.employee) {
        await this.notifications.notifyEmployee(
          tx,
          target.employee.id,
          {
            type: 'ASSIGNMENT_ACKNOWLEDGEMENT',
            title: `Please acknowledge ${asset.assetTag}`,
            message: `${asset.name} has been assigned to you. Review and acknowledge receipt.`,
            entityType: 'asset_assignment',
            entityId: created.id,
            link: `/assets/${assetId}`,
          },
          user.id,
        );
      }
      return created;
    });

    await this.attachForms(assignment.id, 'HANDOVER', signature, user.id, target.employee?.id);
    return this.get(assignment.id, user);
  }

  async returnAsset(assetId: string, dto: ReturnAssetDto, user: AuthUser) {
    const asset = await this.assets.findVisible(assetId, user);
    const active = asset.assignments[0];
    if (!active) throw Errors.invalidState('This asset is not currently assigned');
    if (asset.status !== 'ASSIGNED') {
      throw Errors.invalidState('Complete open maintenance before returning this asset');
    }
    const signature = this.parseSignature(dto.signature);
    const lines = new Map((dto.accessories ?? []).map((l) => [l.accessoryAssignmentId, l]));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.assetAssignment.updateMany({
        where: { id: active.id, status: 'ACTIVE' },
        data: {
          status: 'RETURNED',
          returnedAt: now,
          returnedById: user.id,
          conditionAtReturn: dto.condition,
          returnNotes: dto.notes,
        },
      });
      if (closed.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'This assignment was already closed');

      for (const acc of active.accessoryAssignments) {
        const line = lines.get(acc.id);
        await this.returnAccessory(
          tx,
          acc,
          line?.returned ?? true,
          line?.condition ?? dto.condition,
          user.id,
          now,
        );
      }

      await this.assets.setStatus(tx, assetId, 'ASSIGNED', dto.returnTo, {
        condition: dto.condition,
        updatedById: user.id,
      });
      await this.history.record(tx, {
        assetId,
        action: 'RETURNED',
        fromStatus: 'ASSIGNED',
        toStatus: dto.returnTo,
        assignmentId: active.id,
        performedById: user.id,
        description: `Returned${active.employee ? ` by ${active.employee.firstName} ${active.employee.lastName}` : ''} in ${dto.condition} condition`,
      });

      if (dto.returnTo === 'IN_REPAIR') {
        const maintenance = await tx.maintenance.create({
          data: {
            assetId,
            type: 'REPAIR',
            status: 'IN_PROGRESS',
            priority: dto.condition === 'DAMAGED' ? 'HIGH' : 'MEDIUM',
            title: dto.repairTitle?.trim() || 'Repair after return',
            description: dto.notes,
            reportedById: user.id,
            assetStatusBefore: 'IN_STOCK',
            startedAt: now,
          },
        });
        await this.history.record(tx, {
          assetId,
          action: 'MAINTENANCE_STARTED',
          fromStatus: 'ASSIGNED',
          toStatus: 'IN_REPAIR',
          maintenanceId: maintenance.id,
          performedById: user.id,
          description: maintenance.title,
        });
      }

      await this.activity.record(
        {
          actorId: user.id,
          action: 'asset.return',
          entityType: 'asset',
          entityId: assetId,
          oldValues: { status: 'ASSIGNED', assignmentId: active.id },
          newValues: {
            status: dto.returnTo,
            condition: dto.condition,
            accessories: dto.accessories,
          },
        },
        tx,
      );
    });

    await this.attachForms(active.id, 'RETURN', signature, user.id, active.employeeId);
    return this.get(active.id, user);
  }

  async transfer(assetId: string, dto: TransferAssetDto, user: AuthUser) {
    const asset = await this.assets.findVisible(assetId, user);
    const active = asset.assignments[0];
    if (!active || asset.status !== 'ASSIGNED')
      throw Errors.invalidState('Only assigned assets can be transferred');
    const target = await this.resolveTarget(dto.employeeId, dto.locationId);
    if (
      (target.employee?.id ?? null) === active.employeeId &&
      (target.location?.id ?? null) === active.locationId
    ) {
      throw Errors.badRequest(
        'The asset is already assigned to this employee/location',
        'employeeId',
      );
    }
    const signature = this.parseSignature(dto.signature);
    const now = new Date();

    const next = await this.prisma.$transaction(async (tx) => {
      const closed = await tx.assetAssignment.updateMany({
        where: { id: active.id, status: 'ACTIVE' },
        data: {
          status: 'TRANSFERRED',
          returnedAt: now,
          returnedById: user.id,
          conditionAtReturn: dto.condition,
          returnNotes: `Transferred: ${dto.reason}`,
        },
      });
      if (closed.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'This assignment was already closed');

      const created = await tx.assetAssignment.create({
        data: {
          assetId,
          employeeId: target.employee?.id,
          locationId: target.location?.id,
          conditionAtAssignment: dto.condition,
          expectedReturnAt: dto.expectedReturnAt,
          notes: dto.notes,
          assignedById: user.id,
          previousAssignmentId: active.id,
          transferReason: dto.reason,
          acknowledgedAt: signature ? now : null,
        },
      });

      // Accessories travel with the asset: close the old lines and reopen them for the new holder.
      for (const acc of active.accessoryAssignments) {
        if (target.employee) {
          await tx.accessoryAssignment.update({
            where: { id: acc.id },
            data: {
              status: 'RETURNED',
              returnedAt: now,
              returnedById: user.id,
              notes: 'Transferred with asset',
            },
          });
          await tx.accessoryAssignment.create({
            data: {
              accessoryId: acc.accessoryId,
              employeeId: target.employee.id,
              assetAssignmentId: created.id,
              quantity: acc.quantity,
              assignedById: user.id,
              conditionAtAssignment: acc.conditionAtAssignment,
            },
          });
        } else {
          await this.returnAccessory(
            tx,
            acc,
            true,
            acc.conditionAtAssignment ?? dto.condition,
            user.id,
            now,
          );
        }
      }

      const newLocationId = target.location?.id ?? target.employee?.locationId ?? asset.locationId;
      await this.assets.setStatus(tx, assetId, 'ASSIGNED', 'ASSIGNED', {
        condition: dto.condition,
        locationId: newLocationId,
        updatedById: user.id,
      });
      const fromLabel = active.employee
        ? `${active.employee.firstName} ${active.employee.lastName}`
        : active.location?.name;
      await this.history.record(tx, {
        assetId,
        action: 'TRANSFERRED',
        fromStatus: 'ASSIGNED',
        toStatus: 'ASSIGNED',
        fromLocationId: asset.locationId,
        toLocationId: newLocationId,
        assignmentId: created.id,
        performedById: user.id,
        description: `Transferred from ${fromLabel ?? 'previous holder'} to ${target.label}: ${dto.reason}`,
        metadata: { previousAssignmentId: active.id },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'asset.transfer',
          entityType: 'asset',
          entityId: assetId,
          oldValues: {
            assignmentId: active.id,
            employeeId: active.employeeId,
            locationId: active.locationId,
          },
          newValues: {
            assignmentId: created.id,
            employeeId: target.employee?.id,
            locationId: target.location?.id,
            reason: dto.reason,
          },
        },
        tx,
      );
      if (!signature && target.employee) {
        await this.notifications.notifyEmployee(
          tx,
          target.employee.id,
          {
            type: 'ASSIGNMENT_ACKNOWLEDGEMENT',
            title: `Please acknowledge ${asset.assetTag}`,
            message: `${asset.name} has been transferred to you. Review and acknowledge receipt.`,
            entityType: 'asset_assignment',
            entityId: created.id,
            link: `/assets/${assetId}`,
          },
          user.id,
        );
      }
      return created;
    });

    await this.attachForms(next.id, 'HANDOVER', signature, user.id, target.employee?.id);
    return this.get(next.id, user);
  }

  async acknowledge(id: string, dto: AcknowledgeDto, user: AuthUser) {
    const assignment = await this.prisma.assetAssignment.findUnique({ where: { id } });
    if (!assignment || !user.employeeId || assignment.employeeId !== user.employeeId) {
      throw Errors.notFound('Assignment');
    }
    if (assignment.status !== 'ACTIVE')
      throw Errors.invalidState('Only active assignments can be acknowledged');
    if (assignment.acknowledgedAt)
      throw Errors.invalidState('This assignment is already acknowledged');
    const signature = this.parseSignature(dto.signature);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetAssignment.updateMany({
        where: { id, acknowledgedAt: null },
        data: { acknowledgedAt: new Date() },
      });
      if (updated.count !== 1) throw Errors.invalidState('This assignment is already acknowledged');
      await this.activity.record(
        {
          actorId: user.id,
          action: 'asset.acknowledge',
          entityType: 'asset_assignment',
          entityId: id,
          newValues: { signed: !!signature },
        },
        tx,
      );
    });
    await this.attachForms(id, 'HANDOVER', signature, user.id, assignment.employeeId);
    return this.get(id, user);
  }

  /** Store the signature and the generated PDF. Runs after commit; failures are logged, not fatal. */
  private async attachForms(
    assignmentId: string,
    kind: 'HANDOVER' | 'RETURN',
    signature: Buffer | undefined,
    actorId: string,
    employeeId: string | null | undefined,
  ): Promise<void> {
    try {
      const assignment = await this.prisma.assetAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: { assetId: true, asset: { select: { assetTag: true } } },
      });
      const owner = {
        assignmentId,
        assetId: assignment.assetId,
        employeeId: employeeId ?? undefined,
      };
      const pdf = await this.handoverPdf.render(assignmentId, kind, signature);
      await this.prisma.$transaction(async (tx) => {
        if (signature) {
          await this.documents.store(
            tx,
            {
              buffer: signature,
              mimeType: 'image/png',
              type: 'SIGNATURE',
              title: `${kind === 'RETURN' ? 'Return' : 'Handover'} signature — ${assignment.asset.assetTag}`,
              originalFileName: `signature-${assignment.asset.assetTag}.png`,
              owner: { assignmentId, employeeId: employeeId ?? undefined },
            },
            actorId,
          );
        }
        await this.documents.store(
          tx,
          {
            buffer: pdf,
            mimeType: 'application/pdf',
            type: kind === 'RETURN' ? 'RETURN_FORM' : 'HANDOVER_FORM',
            title: `${kind === 'RETURN' ? 'Return form' : 'Handover form'} — ${assignment.asset.assetTag}${signature ? ' (signed)' : ''}`,
            originalFileName: `${kind === 'RETURN' ? 'return' : 'handover'}-${assignment.asset.assetTag}.pdf`,
            owner,
          },
          actorId,
        );
      });
    } catch (error) {
      this.logger.error({ err: error, assignmentId }, `Failed to generate ${kind} form`);
    }
  }

  private parseSignature(dataUrl: string | undefined): Buffer | undefined {
    if (!dataUrl) return undefined;
    try {
      return decodeSignature(dataUrl);
    } catch (error) {
      throw Errors.badRequest((error as Error).message, 'signature');
    }
  }

  private async resolveTarget(employeeId?: string, locationId?: string) {
    if (!employeeId && !locationId)
      throw Errors.badRequest('Choose an employee or a location', 'employeeId');
    const employee = employeeId
      ? await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } })
      : null;
    if (employeeId && !employee) throw Errors.badRequest('Employee not found', 'employeeId');
    if (employee?.status === 'TERMINATED')
      throw Errors.badRequest('Cannot assign to a terminated employee', 'employeeId');
    const location = locationId
      ? await this.prisma.location.findFirst({ where: { id: locationId, deletedAt: null } })
      : null;
    if (locationId && !location) throw Errors.badRequest('Location not found', 'locationId');
    const label = [employee && `${employee.firstName} ${employee.lastName}`, location?.name]
      .filter(Boolean)
      .join(' @ ');
    return { employee, location, label };
  }

  private async takeAccessory(db: Db, accessoryId: string, quantity: number): Promise<void> {
    const taken = await db.accessory.updateMany({
      where: { id: accessoryId, deletedAt: null, quantityAvailable: { gte: quantity } },
      data: { quantityAvailable: { decrement: quantity } },
    });
    if (taken.count !== 1) {
      const accessory = await db.accessory.findFirst({
        where: { id: accessoryId, deletedAt: null },
      });
      if (!accessory) throw Errors.badRequest('Accessory not found', 'accessories');
      throw Errors.conflict(
        'ACCESSORY_OUT_OF_STOCK',
        `Only ${accessory.quantityAvailable} × ${accessory.name} available`,
      );
    }
  }

  /** Returned in usable condition → back to stock; missing or damaged → written off from the total. */
  private async returnAccessory(
    db: Db,
    acc: { id: string; accessoryId: string; quantity: number },
    returned: boolean,
    condition: AssetCondition,
    userId: string,
    now: Date,
  ): Promise<void> {
    const usable = returned && condition !== 'DAMAGED';
    await db.accessoryAssignment.update({
      where: { id: acc.id },
      data: {
        status: 'RETURNED',
        returnedAt: now,
        returnedById: userId,
        conditionAtReturn: returned ? condition : null,
        notes: returned
          ? usable
            ? null
            : 'Returned damaged — written off'
          : 'Not returned — written off',
      },
    });
    await db.accessory.update({
      where: { id: acc.accessoryId },
      data: usable
        ? { quantityAvailable: { increment: acc.quantity } }
        : { quantityTotal: { decrement: acc.quantity } },
    });
  }
}

function mergeLines(lines: { accessoryId: string; quantity: number }[]) {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.accessoryId, (merged.get(l.accessoryId) ?? 0) + l.quantity);
  return [...merged].map(([accessoryId, quantity]) => ({ accessoryId, quantity }));
}
