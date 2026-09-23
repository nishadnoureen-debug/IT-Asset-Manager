import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, OmitType, PartialType } from '@nestjs/swagger';
import {
  AssetCondition,
  MaintenanceStatus,
  MaintenanceType,
  Prisma,
  Priority,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { AssetsService } from '../assets/assets.service';
import { trim, upper } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { documentSelect } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const money = () => (target: object, key: string) => {
  Type(() => Number)(target, key);
  IsNumber({ maxDecimalPlaces: 2 })(target, key);
  Min(0)(target, key);
  Max(999_999_999)(target, key);
};

class CreateMaintenanceDto {
  @IsUUID() assetId!: string;
  @IsOptional() @IsEnum(MaintenanceType) type?: MaintenanceType;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsBoolean() isWarrantyClaim?: boolean;
  @IsOptional() @Type(() => Date) @IsDate() scheduledAt?: Date;
  /** Start work immediately (asset moves to In repair). */
  @IsOptional() @IsBoolean() startNow?: boolean;
}

class UpdateMaintenanceDto extends PartialType(
  OmitType(CreateMaintenanceDto, ['assetId', 'startNow'] as const),
) {
  @IsOptional() @money() laborCost?: number;
  @IsOptional() @money() partsCost?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
}

class CompleteMaintenanceDto {
  @IsOptional() @money() laborCost?: number;
  @IsOptional() @money() partsCost?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(5000) resolutionNotes!: string;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
}

class CancelMaintenanceDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
}

class MaintenanceQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(MaintenanceStatus) status?: MaintenanceStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsEnum(MaintenanceType) type?: MaintenanceType;
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  open?: boolean;
}

const include = {
  asset: {
    select: {
      id: true,
      assetTag: true,
      name: true,
      status: true,
      assetType: { select: { name: true, category: true } },
    },
  },
  technician: { select: { id: true, displayName: true } },
  reportedBy: { select: { id: true, displayName: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.MaintenanceInclude;

@ApiTags('Maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @RequirePermissions('maintenance.view')
  list(@Query() q: MaintenanceQueryDto) {
    const where: Prisma.MaintenanceWhereInput = {
      status: q.open ? { in: ['SCHEDULED', 'IN_PROGRESS'] } : q.status,
      priority: q.priority,
      type: q.type,
      assetId: q.assetId,
      technicianId: q.technicianId,
      vendorId: q.vendorId,
      OR: searchFilter(q.search, ['title', 'description', 'asset.assetTag', 'asset.name']),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.maintenance.findMany({
          where,
          include,
          orderBy: resolveOrderBy<Prisma.MaintenanceOrderByWithRelationInput>(
            q,
            {
              createdAt: (o) => ({ createdAt: o }),
              scheduledAt: (o) => ({ scheduledAt: { sort: o, nulls: 'last' } }),
              priority: (o) => ({ priority: o }),
              status: (o) => ({ status: o }),
              number: (o) => ({ number: o }),
            },
            { createdAt: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.maintenance.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions('maintenance.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const record = await this.prisma.maintenance.findUnique({
      where: { id },
      include: { ...include, documents: { where: { deletedAt: null }, select: documentSelect } },
    });
    if (!record) throw Errors.notFound('Maintenance record');
    return record;
  }

  @Post()
  @RequirePermissions('maintenance.create')
  async create(@Body() dto: CreateMaintenanceDto, @CurrentUser() user: AuthUser) {
    const asset = await this.assets.findVisible(dto.assetId, user);
    if (['RETIRED', 'DISPOSED', 'LOST'].includes(asset.status)) {
      throw Errors.invalidState(
        `Maintenance cannot be logged for ${asset.status.toLowerCase()} assets`,
      );
    }
    if (asset.maintenance.length)
      throw Errors.invalidState('This asset already has open maintenance');
    await this.assertRefs(dto);
    const { startNow, ...data } = dto;

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.maintenance.create({
        data: {
          ...data,
          reportedById: user.id,
          status: startNow ? 'IN_PROGRESS' : 'SCHEDULED',
          startedAt: startNow ? new Date() : undefined,
          assetStatusBefore: startNow ? asset.status : undefined,
        },
      });
      if (startNow)
        await this.moveToRepair(tx, asset.id, asset.status, record.id, record.title, user.id);
      await this.activity.record(
        {
          actorId: user.id,
          action: 'maintenance.create',
          entityType: 'maintenance',
          entityId: record.id,
          newValues: dto,
        },
        tx,
      );
      await this.notifyTechnician(
        tx,
        record.technicianId,
        record.id,
        asset.assetTag,
        record.title,
        user.id,
      );
      return record;
    });
    return this.get(created.id);
  }

  @Patch(':id')
  @RequirePermissions('maintenance.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.get(id);
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw Errors.invalidState('Closed maintenance records cannot be edited');
    }
    await this.assertRefs(dto);
    const { asset, technician, reportedBy, vendor, documents, ...before } = existing;
    const changes = diff(before as Record<string, unknown>, dto as Record<string, unknown>);
    if (!changes) return existing;
    await this.prisma.$transaction(async (tx) => {
      await tx.maintenance.update({
        where: { id },
        data: {
          ...dto,
          totalCost: this.total(
            dto.laborCost ?? before.laborCost,
            dto.partsCost ?? before.partsCost,
          ),
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'maintenance.update',
          entityType: 'maintenance',
          entityId: id,
          ...changes,
        },
        tx,
      );
      if (dto.technicianId && dto.technicianId !== before.technicianId) {
        await this.notifyTechnician(
          tx,
          dto.technicianId,
          id,
          asset.assetTag,
          dto.title ?? before.title,
          user.id,
        );
      }
    });
    return this.get(id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('maintenance.edit')
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const record = await this.get(id);
    if (record.status !== 'SCHEDULED')
      throw Errors.invalidState('Only scheduled maintenance can be started');
    const asset = await this.assets.findVisible(record.assetId, user);
    await this.prisma.$transaction(async (tx) => {
      const started = await tx.maintenance.updateMany({
        where: { id, status: 'SCHEDULED' },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), assetStatusBefore: asset.status },
      });
      if (started.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'Maintenance was already started');
      await this.moveToRepair(tx, asset.id, asset.status, id, record.title, user.id);
      await this.activity.record(
        { actorId: user.id, action: 'maintenance.start', entityType: 'maintenance', entityId: id },
        tx,
      );
    });
    return this.get(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('maintenance.complete')
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteMaintenanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    const record = await this.get(id);
    if (record.status !== 'IN_PROGRESS')
      throw Errors.invalidState('Only maintenance in progress can be completed');
    const asset = await this.assets.findVisible(record.assetId, user);
    const { defaultCurrency } = await this.settings.get();
    const laborCost = dto.laborCost ?? record.laborCost;
    const partsCost = dto.partsCost ?? record.partsCost;

    await this.prisma.$transaction(async (tx) => {
      const done = await tx.maintenance.updateMany({
        where: { id, status: 'IN_PROGRESS' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          laborCost: laborCost ?? undefined,
          partsCost: partsCost ?? undefined,
          totalCost: this.total(laborCost, partsCost),
          currency: dto.currency ?? record.currency ?? defaultCurrency,
          resolutionNotes: dto.resolutionNotes,
        },
      });
      if (done.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'Maintenance was already closed');
      // Spec: Complete → Available / Assigned.
      if (asset.status === 'IN_REPAIR') {
        const next = asset.assignments.length ? 'ASSIGNED' : 'AVAILABLE';
        await this.assets.setStatus(tx, asset.id, 'IN_REPAIR', next, {
          condition: dto.condition,
          updatedById: user.id,
        });
        await this.history.record(tx, {
          assetId: asset.id,
          action: 'MAINTENANCE_COMPLETED',
          fromStatus: 'IN_REPAIR',
          toStatus: next,
          maintenanceId: id,
          performedById: user.id,
          description: dto.resolutionNotes,
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'maintenance.complete',
          entityType: 'maintenance',
          entityId: id,
          newValues: dto,
        },
        tx,
      );
      if (record.reportedBy && record.reportedBy.id !== user.id) {
        await this.notifications.notifyUsers(tx, [record.reportedBy.id], {
          type: 'MAINTENANCE_UPDATE',
          title: `Maintenance completed: ${asset.assetTag}`,
          message: record.title,
          entityType: 'maintenance',
          entityId: id,
          link: `/maintenance/${id}`,
        });
      }
    });
    return this.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('maintenance.edit')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelMaintenanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    const record = await this.get(id);
    if (record.status === 'COMPLETED' || record.status === 'CANCELLED')
      throw Errors.invalidState('Maintenance is already closed');
    const asset = await this.assets.findVisible(record.assetId, user);
    await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.maintenance.updateMany({
        where: { id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          resolutionNotes: `Cancelled: ${dto.reason}`,
        },
      });
      if (cancelled.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'Maintenance was already closed');
      if (record.status === 'IN_PROGRESS' && asset.status === 'IN_REPAIR') {
        const restore = asset.assignments.length
          ? 'ASSIGNED'
          : record.assetStatusBefore === 'IN_STOCK'
            ? 'IN_STOCK'
            : 'AVAILABLE';
        await this.assets.setStatus(tx, asset.id, 'IN_REPAIR', restore, { updatedById: user.id });
        await this.history.record(tx, {
          assetId: asset.id,
          action: 'STATUS_CHANGED',
          fromStatus: 'IN_REPAIR',
          toStatus: restore,
          maintenanceId: id,
          performedById: user.id,
          description: `Maintenance cancelled: ${dto.reason}`,
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'maintenance.cancel',
          entityType: 'maintenance',
          entityId: id,
          newValues: dto,
        },
        tx,
      );
    });
    return this.get(id);
  }

  private async moveToRepair(
    tx: Prisma.TransactionClient,
    assetId: string,
    from: Parameters<AssetsService['setStatus']>[2],
    maintenanceId: string,
    title: string,
    userId: string,
  ) {
    this.assets.assertTransition(from, 'IN_REPAIR');
    await this.assets.setStatus(tx, assetId, from, 'IN_REPAIR', { updatedById: userId });
    await this.history.record(tx, {
      assetId,
      action: 'MAINTENANCE_STARTED',
      fromStatus: from,
      toStatus: 'IN_REPAIR',
      maintenanceId,
      performedById: userId,
      description: title,
    });
  }

  private async notifyTechnician(
    tx: Prisma.TransactionClient,
    technicianId: string | null | undefined,
    id: string,
    assetTag: string,
    title: string,
    actorId: string,
  ) {
    if (!technicianId) return;
    await this.notifications.notifyUsers(
      tx,
      [technicianId],
      {
        type: 'MAINTENANCE_UPDATE',
        title: `Maintenance assigned: ${assetTag}`,
        message: title,
        entityType: 'maintenance',
        entityId: id,
        link: `/maintenance/${id}`,
      },
      { excludeUserId: actorId },
    );
  }

  private total(
    labor: Prisma.Decimal | number | null | undefined,
    parts: Prisma.Decimal | number | null | undefined,
  ) {
    if (labor == null && parts == null) return undefined;
    return Math.round((Number(labor ?? 0) + Number(parts ?? 0)) * 100) / 100;
  }

  private async assertRefs(dto: { technicianId?: string; vendorId?: string }) {
    if (dto.technicianId) {
      const tech = await this.prisma.user.findFirst({
        where: {
          id: dto.technicianId,
          deletedAt: null,
          status: 'ACTIVE',
          roles: {
            some: { role: { permissions: { some: { permission: { key: 'maintenance.edit' } } } } },
          },
        },
      });
      if (!tech)
        throw Errors.badRequest(
          'Technician must be an active user who can work on maintenance',
          'technicianId',
        );
    }
    if (
      dto.vendorId &&
      !(await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Vendor not found', 'vendorId');
    }
  }
}
