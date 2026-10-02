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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiTags, PartialType } from '@nestjs/swagger';
import { AccessoryCategory, AssetCondition, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
import type { Response } from 'express';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { trim, upper } from '../assets/assets.dto';
import { dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { QrService, parseScannedCode } from '../qr/qr.service';
import { AccessoryUnitsService, unitSelect } from './accessory-units.service';
import { SettingsService } from '../settings/settings.service';

class CreateAccessoryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  /** Left out, a code is generated from the prefix in Settings. */
  @IsOptional() @Transform(upper) @IsString() @MaxLength(32) code?: string;
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
  /** The pieces to hand over; left out, the lowest-numbered ones in the store are used. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) unitIds?: string[];
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ReturnAccessoryDto {
  @IsEnum(AssetCondition) condition!: AssetCondition;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class QrFormatQueryDto {
  @IsOptional() @IsIn(['png', 'svg']) format: 'png' | 'svg' = 'png';
}

class ScanAccessoryDto {
  @IsString() @MinLength(1) @MaxLength(512) code!: string;
}

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

class LabelsQueryDto {
  /** Every piece of these accessories. */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(240)
  @IsUUID('all', { each: true })
  ids?: string[];
  /** Just these pieces. */
  @IsOptional()
  @Transform(csv)
  @IsArray()
  @ArrayMaxSize(240)
  @IsUUID('all', { each: true })
  unitIds?: string[];
}

class UpdateAccessoryUnitDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@ApiTags('Accessories')
@Controller()
export class AccessoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly qr: QrService,
    private readonly units: AccessoryUnitsService,
  ) {}

  @Get('accessories')
  @RequirePermissions('accessory.view', 'accessory.manage')
  async list(@Query() q: AccessoryQueryDto) {
    const where: Prisma.AccessoryWhereInput = {
      deletedAt: null,
      category: q.category,
      locationId: q.locationId,
      OR: q.search
        ? [
            ...(searchFilter(q.search, ['code', 'name', 'sku', 'brand', 'model']) ?? []),
            // A piece's code finds the accessory it belongs to.
            { units: { some: { code: { contains: q.search, mode: 'insensitive' } } } },
          ]
        : undefined,
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
    const { defaultCurrency, accessoryCodePrefix } = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      const accessory = await tx.accessory.create({
        data: {
          ...dto,
          code: dto.code ?? (await this.nextCode(tx, accessoryCodePrefix)),
          currency: dto.unitCost !== undefined ? (dto.currency ?? defaultCurrency) : dto.currency,
          quantityAvailable: dto.quantityTotal ?? 0,
        },
      });
      await this.units.add(tx, accessory.id, dto.quantityTotal ?? 0);
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
    const delta = (dto.quantityTotal ?? existing.quantityTotal) - existing.quantityTotal;
    return this.prisma.$transaction(async (tx) => {
      const accessory = await tx.accessory.update({ where: { id }, data });
      if (delta > 0) await this.units.add(tx, id, delta);
      if (delta < 0) await this.units.retire(tx, id, -delta);
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
      await this.units.take(tx, id, dto.quantity, assignment.id, dto.unitIds);
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
      await this.units.release(tx, id, !usable);
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

  // ── Labels ────────────────────────────────────────────────────────────────

  /** Every piece of an accessory, with its code and who is holding it. */
  @Get('accessories/:id/units')
  @RequirePermissions('accessory.view', 'accessory.manage')
  async listUnits(@Param('id', ParseUUIDPipe) id: string) {
    await this.find(id);
    return this.units.list(id);
  }

  /** The QR image of one piece, to show on screen. */
  @Get('accessory-units/:id/qr')
  @RequirePermissions('accessory.view', 'accessory.manage')
  async unitQr(@Param('id', ParseUUIDPipe) id: string) {
    const unit = await this.findUnit(id);
    return this.qr.codeImage(unit.code, unit.qrToken);
  }

  /** One piece's QR on its own, as a PNG or an SVG. */
  @Get('accessory-units/:id/qr/download')
  @SkipEnvelope()
  @RequirePermissions('accessory.view', 'accessory.manage')
  async unitQrDownload(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: QrFormatQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const unit = await this.findUnit(id);
    const file = await this.qr.image(unit.qrToken, q.format, unit.code);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    return new StreamableFile(file.body);
  }

  /**
   * A sheet of printable labels, one per piece: QR, piece code and the accessory's name. Give it
   * accessory ids for every piece of those accessories, or piece ids for just those.
   */
  @Get('accessories/qr/labels')
  @SkipEnvelope()
  @RequirePermissions('accessory.view', 'accessory.manage')
  async labels(@Query() q: LabelsQueryDto, @Res({ passthrough: true }) res: Response) {
    const ids = [...(q.ids ?? []), ...(q.unitIds ?? [])];
    if (!ids.length) throw Errors.badRequest('Select at least one accessory', 'ids');
    const units = await this.prisma.accessoryUnit.findMany({
      where: {
        status: { not: 'RETIRED' },
        OR: [
          ...(q.ids?.length ? [{ accessoryId: { in: q.ids } }] : []),
          ...(q.unitIds?.length ? [{ id: { in: q.unitIds } }] : []),
        ],
      },
      orderBy: [{ accessory: { code: 'asc' } }, { number: 'asc' }],
      select: {
        code: true,
        qrToken: true,
        serialNumber: true,
        accessory: { select: { name: true, sku: true } },
      },
    });
    if (!units.length) throw Errors.notFound('Accessory pieces');
    const pdf = await this.qr.renderLabels(
      units.map((u) => ({
        code: u.code,
        name: u.accessory.name,
        note: u.serialNumber ? `S/N ${u.serialNumber}` : u.accessory.sku,
        qrToken: u.qrToken,
      })),
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="accessory-labels.pdf"',
    });
    return new StreamableFile(pdf);
  }

  /** New QR token for one piece: the label printed before it stops working. */
  @Post('accessory-units/:id/qr/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('accessory.manage')
  async regenerateUnitQr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const unit = await this.findUnit(id);
    const updated = await this.prisma.accessoryUnit.update({
      where: { id },
      data: { qrToken: randomUUID() },
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'accessory.qr_regenerate',
      entityType: 'accessory',
      entityId: unit.accessoryId,
      oldValues: { code: unit.code },
    });
    return this.qr.codeImage(updated.code, updated.qrToken);
  }

  /** Records the serial number written on a piece. */
  @Patch('accessory-units/:id')
  @RequirePermissions('accessory.manage')
  async updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessoryUnitDto,
    @CurrentUser() user: AuthUser,
  ) {
    const unit = await this.findUnit(id);
    const updated = await this.prisma.accessoryUnit.update({
      where: { id },
      data: { serialNumber: dto.serialNumber ?? null, notes: dto.notes ?? null },
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'accessory.unit_update',
      entityType: 'accessory',
      entityId: unit.accessoryId,
      newValues: { code: unit.code, ...dto },
    });
    return updated;
  }

  /**
   * Resolves a scanned label to the piece it is on, with the accessory it belongs to and whoever is
   * holding it. An accessory's own code or SKU finds the accessory itself.
   */
  @Post('accessories/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('accessory.view', 'accessory.manage')
  async scan(@Body() dto: ScanAccessoryDto) {
    const { token, text } = parseScannedCode(dto.code);
    const unit = await this.prisma.accessoryUnit.findFirst({
      where: token ? { qrToken: token } : { code: { equals: text, mode: 'insensitive' } },
      select: {
        ...unitSelect,
        accessory: { select: { id: true, code: true, name: true, category: true } },
        assignment: {
          select: {
            id: true,
            assignedAt: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
          },
        },
      },
    });
    if (unit) return { unit, accessory: unit.accessory };
    const accessory = await this.prisma.accessory.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { code: { equals: text, mode: 'insensitive' } },
          { sku: { equals: text, mode: 'insensitive' } },
        ],
      },
      include: { location: { select: { id: true, name: true } } },
    });
    if (!accessory) throw Errors.notFound('No accessory matches this code');
    return { unit: null, accessory };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async findUnit(id: string) {
    const unit = await this.prisma.accessoryUnit.findUnique({ where: { id } });
    if (!unit) throw Errors.notFound('Accessory piece');
    return unit;
  }

  private async find(id: string) {
    const accessory = await this.prisma.accessory.findFirst({ where: { id, deletedAt: null } });
    if (!accessory) throw Errors.notFound('Accessory');
    return accessory;
  }

  /** The next free code from the sequence, e.g. ACC-000123. */
  private async nextCode(db: Prisma.TransactionClient, prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [{ nextval }] = await db.$queryRaw<
        { nextval: bigint }[]
      >`SELECT nextval('accessory_code_seq')`;
      const code = `${prefix}-${String(nextval).padStart(6, '0')}`;
      if (!(await db.accessory.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw Errors.conflict('ACCESSORY_CODE_EXHAUSTED', 'Could not generate a unique accessory code');
  }
}
