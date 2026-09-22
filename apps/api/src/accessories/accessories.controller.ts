import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, PartialType } from '@nestjs/swagger';
import { AccessoryCategory, AssetCondition, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
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
import { trim, upper } from '../assets/assets.dto';
import { dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

class CreateAccessoryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsEnum(AccessoryCategory) category!: AccessoryCategory;
  @IsOptional() @Transform(upper) @IsString() @MaxLength(64) sku?: string;
  @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @IsOptional() @IsString() @MaxLength(120) model?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) quantityTotal?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) minStockLevel?: number;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitCost?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
class UpdateAccessoryDto extends PartialType(CreateAccessoryDto) {}

class AccessoryQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(AccessoryCategory) category?: AccessoryCategory;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  lowStock?: boolean;
}

class AssignAccessoryDto {
  @IsUUID() employeeId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity: number = 1;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ReturnAccessoryDto {
  @IsEnum(AssetCondition) condition!: AssetCondition;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@ApiTags('Accessories')
@Controller()
export class AccessoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  @Get('accessories')
  @RequirePermissions('accessory.view', 'accessory.manage')
  async list(@Query() q: AccessoryQueryDto) {
    const where: Prisma.AccessoryWhereInput = {
      deletedAt: null,
      category: q.category,
      locationId: q.locationId,
      OR: searchFilter(q.search, ['name', 'sku', 'brand', 'model']),
    };
    if (q.lowStock) {
      // Column-to-column comparison is not expressible in the Prisma filter API.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM accessories WHERE deleted_at IS NULL AND quantity_available <= min_stock_level`;
      where.id = { in: rows.map((r) => r.id) };
    }
    return paginate(
      q,
      (page) =>
        this.prisma.accessory.findMany({
          where,
          include: { location: { select: { id: true, name: true } } },
          orderBy: resolveOrderBy<Prisma.AccessoryOrderByWithRelationInput>(
            q,
            {
              name: (o) => ({ name: o }),
              quantityAvailable: (o) => ({ quantityAvailable: o }),
              category: (o) => ({ category: o }),
            },
            { name: 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.accessory.count({ where }),
    );
  }

  @Get('accessories/:id')
  @RequirePermissions('accessory.view', 'accessory.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const accessory = await this.prisma.accessory.findFirst({
      where: { id, deletedAt: null },
      include: {
        location: { select: { id: true, name: true } },
        purchase: { select: { id: true, orderNumber: true } },
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 100,
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
            assetAssignment: {
              select: { id: true, asset: { select: { id: true, assetTag: true } } },
            },
          },
        },
      },
    });
    if (!accessory) throw Errors.notFound('Accessory');
    return accessory;
  }

  @Post('accessories')
  @RequirePermissions('accessory.manage')
  async create(@Body() dto: CreateAccessoryDto, @CurrentUser() user: AuthUser) {
    const { defaultCurrency } = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      const accessory = await tx.accessory.create({
        data: {
          ...dto,
          currency: dto.unitCost !== undefined ? (dto.currency ?? defaultCurrency) : dto.currency,
          quantityAvailable: dto.quantityTotal ?? 0,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'accessory.create',
          entityType: 'accessory',
          entityId: accessory.id,
          newValues: dto,
        },
        tx,
      );
      return accessory;
    });
  }

  /** Changing quantityTotal adjusts available stock by the same delta (never below what is handed out). */
  @Patch('accessories/:id')
  @RequirePermissions('accessory.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.accessory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Accessory');
    const data: Prisma.AccessoryUpdateInput = { ...dto };
    if (dto.quantityTotal !== undefined && dto.quantityTotal !== existing.quantityTotal) {
      const handedOut = existing.quantityTotal - existing.quantityAvailable;
      if (dto.quantityTotal < handedOut) {
        throw Errors.invalidState(`${handedOut} are currently handed out; total cannot be lower`);
      }
      data.quantityAvailable = dto.quantityTotal - handedOut;
    }
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    return this.prisma.$transaction(async (tx) => {
      const accessory = await tx.accessory.update({ where: { id }, data });
      if (changes)
        await this.activity.record(
          {
            actorId: user.id,
            action: 'accessory.update',
            entityType: 'accessory',
            entityId: id,
            ...changes,
          },
          tx,
        );
      return accessory;
    });
  }

  @Delete('accessories/:id')
  @RequirePermissions('accessory.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.prisma.accessory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Accessory');
    if (existing.quantityAvailable < existing.quantityTotal)
      throw Errors.invalidState('Some items are still handed out');
    await this.prisma.$transaction(async (tx) => {
      await tx.accessory.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'accessory.delete',
          entityType: 'accessory',
          entityId: id,
          oldValues: { name: existing.name },
        },
        tx,
      );
    });
    return { id, deleted: true };
  }

  @Post('accessories/:id/assign')
  @RequirePermissions('accessory.assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAccessoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, deletedAt: null },
    });
    if (!employee || employee.status === 'TERMINATED')
      throw Errors.badRequest('Employee not found or terminated', 'employeeId');
    return this.prisma.$transaction(async (tx) => {
      const taken = await tx.accessory.updateMany({
        where: { id, deletedAt: null, quantityAvailable: { gte: dto.quantity } },
        data: { quantityAvailable: { decrement: dto.quantity } },
      });
      if (taken.count !== 1) {
        const accessory = await tx.accessory.findFirst({ where: { id, deletedAt: null } });
        if (!accessory) throw Errors.notFound('Accessory');
        throw Errors.conflict(
          'ACCESSORY_OUT_OF_STOCK',
          `Only ${accessory.quantityAvailable} available`,
        );
      }
      const assignment = await tx.accessoryAssignment.create({
        data: {
          accessoryId: id,
          employeeId: dto.employeeId,
          quantity: dto.quantity,
          conditionAtAssignment: dto.condition,
          notes: dto.notes,
          assignedById: user.id,
        },
        include: { accessory: { select: { id: true, name: true } } },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'accessory.assign',
          entityType: 'accessory',
          entityId: id,
          newValues: { ...dto, accessoryAssignmentId: assignment.id },
        },
        tx,
      );
      return assignment;
    });
  }

  @Get('accessory-assignments')
  @RequirePermissions('accessory.view', 'accessory.manage', 'asset.view_own')
  listAssignments(
    @Query() q: PaginationQueryDto & { employeeId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    const where: Prisma.AccessoryAssignmentWhereInput = { status: 'ACTIVE' };
    if (dataScope(user, 'asset') !== 'all' && !user.permissions.has('accessory.view')) {
      where.employeeId = user.employeeId ?? NO_MATCH_ID;
    }
    return this.prisma.accessoryAssignment.findMany({
      where,
      include: {
        accessory: { select: { id: true, name: true, category: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { assignedAt: 'desc' },
      take: 200,
    });
  }

  @Post('accessory-assignments/:id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('accessory.assign', 'asset.return')
  async returnAccessory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAccessoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const assignment = await this.prisma.accessoryAssignment.findUnique({ where: { id } });
    if (!assignment) throw Errors.notFound('Accessory assignment');
    if (assignment.status !== 'ACTIVE') throw Errors.invalidState('Already returned');
    const usable = dto.condition !== 'DAMAGED';
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.accessoryAssignment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: {
          status: 'RETURNED',
          returnedAt: new Date(),
          returnedById: user.id,
          conditionAtReturn: dto.condition,
          notes: dto.notes ?? (usable ? null : 'Returned damaged — written off'),
        },
      });
      if (closed.count !== 1) throw Errors.invalidState('Already returned');
      await tx.accessory.update({
        where: { id: assignment.accessoryId },
        data: usable
          ? { quantityAvailable: { increment: assignment.quantity } }
          : { quantityTotal: { decrement: assignment.quantity } },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'accessory.return',
          entityType: 'accessory',
          entityId: assignment.accessoryId,
          newValues: { accessoryAssignmentId: id, ...dto },
        },
        tx,
      );
      return tx.accessoryAssignment.findUniqueOrThrow({
        where: { id },
        include: { accessory: { select: { id: true, name: true } } },
      });
    });
  }
}
