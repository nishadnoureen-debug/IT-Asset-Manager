import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, PartialType } from '@nestjs/swagger';
import { Prisma, VendorType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { trim, upper } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { documentSelect } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

// ─── Vendors ────────────────────────────────────────────────────────────────

class CreateVendorDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsArray() @IsEnum(VendorType, { each: true }) types?: VendorType[];
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl()
  @MaxLength(255)
  website?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(64) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateVendorDto extends PartialType(CreateVendorDto) {}

class VendorQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(VendorType) type?: VendorType;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean;
}

@ApiTags('Vendors')
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @RequirePermissions('vendor.view', 'vendor.manage')
  list(@Query() q: VendorQueryDto) {
    const where: Prisma.VendorWhereInput = {
      deletedAt: null,
      isActive: q.activeOnly ? true : undefined,
      types: q.type ? { has: q.type } : undefined,
      OR: searchFilter(q.search, ['name', 'contactName', 'email']),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.vendor.findMany({
          where,
          include: { _count: { select: { purchases: true, assets: true, maintenance: true } } },
          orderBy: resolveOrderBy<Prisma.VendorOrderByWithRelationInput>(
            q,
            { name: (o) => ({ name: o }), createdAt: (o) => ({ createdAt: o }) },
            { name: 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.vendor.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions('vendor.view', 'vendor.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, deletedAt: null },
      include: {
        purchases: { where: { deletedAt: null }, orderBy: { purchaseDate: 'desc' }, take: 50 },
        _count: {
          select: {
            purchases: true,
            assets: true,
            warrantyAssets: true,
            maintenance: true,
            softwareLicenses: true,
          },
        },
      },
    });
    if (!vendor) throw Errors.notFound('Vendor');
    return vendor;
  }

  @Post()
  @RequirePermissions('vendor.manage')
  create(@Body() dto: CreateVendorDto, @CurrentUser() user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({ data: dto });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'vendor.create',
          entityType: 'vendor',
          entityId: vendor.id,
          newValues: dto,
        },
        tx,
      );
      return vendor;
    });
  }

  @Patch(':id')
  @RequirePermissions('vendor.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.vendor.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Vendor');
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.update({ where: { id }, data: dto });
      if (changes)
        await this.activity.record(
          {
            actorId: user.id,
            action: 'vendor.update',
            entityType: 'vendor',
            entityId: id,
            ...changes,
          },
          tx,
        );
      return vendor;
    });
  }
}

// ─── Purchases ──────────────────────────────────────────────────────────────

class CreatePurchaseDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) orderNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) invoiceNumber?: string;
  @IsUUID() vendorId!: string;
  @Type(() => Date) @IsDate() purchaseDate!: Date;
  @IsOptional() @Type(() => Date) @IsDate() invoiceDate?: Date;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  subtotal?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  taxAmount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  totalAmount?: number;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  /** Link existing assets to this purchase. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) assetIds?: string[];
}
class UpdatePurchaseDto extends PartialType(CreatePurchaseDto) {}

class PurchaseQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

@ApiTags('Purchases')
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @RequirePermissions('purchase.view', 'purchase.manage')
  list(@Query() q: PurchaseQueryDto) {
    const where: Prisma.PurchaseWhereInput = {
      deletedAt: null,
      vendorId: q.vendorId,
      purchaseDate: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
      OR: searchFilter(q.search, ['orderNumber', 'invoiceNumber', 'vendor.name', 'notes']),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.purchase.findMany({
          where,
          include: {
            vendor: { select: { id: true, name: true } },
            _count: {
              select: {
                assets: true,
                accessories: true,
                softwareLicenses: true,
                documents: { where: { deletedAt: null } },
              },
            },
          },
          orderBy: resolveOrderBy<Prisma.PurchaseOrderByWithRelationInput>(
            q,
            {
              purchaseDate: (o) => ({ purchaseDate: o }),
              totalAmount: (o) => ({ totalAmount: o }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { purchaseDate: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.purchase.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions('purchase.view', 'purchase.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, deletedAt: null },
      include: {
        vendor: true,
        createdBy: { select: { id: true, displayName: true } },
        assets: {
          where: { deletedAt: null },
          select: {
            id: true,
            assetTag: true,
            name: true,
            status: true,
            purchaseCost: true,
            currency: true,
          },
          orderBy: { assetTag: 'asc' },
        },
        accessories: {
          where: { deletedAt: null },
          select: { id: true, name: true, quantityTotal: true, unitCost: true },
        },
        softwareLicenses: {
          where: { deletedAt: null },
          select: { id: true, name: true, seats: true, software: { select: { name: true } } },
        },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
    if (!purchase) throw Errors.notFound('Purchase');
    return purchase;
  }

  @Post()
  @RequirePermissions('purchase.manage')
  async create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    await this.assertVendor(dto.vendorId);
    const { assetIds, ...data } = dto;
    const { defaultCurrency } = await this.settings.get();
    const created = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          ...data,
          currency: data.currency ?? defaultCurrency,
          totalAmount: data.totalAmount ?? (data.subtotal ?? 0) + (data.taxAmount ?? 0),
          createdById: user.id,
        },
      });
      if (assetIds?.length) {
        await tx.asset.updateMany({
          where: { id: { in: assetIds }, deletedAt: null },
          data: { purchaseId: purchase.id, vendorId: dto.vendorId, purchaseDate: dto.purchaseDate },
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'purchase.create',
          entityType: 'purchase',
          entityId: purchase.id,
          newValues: dto,
        },
        tx,
      );
      return purchase;
    });
    return this.get(created.id);
  }

  @Patch(':id')
  @RequirePermissions('purchase.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.purchase.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Purchase');
    if (dto.vendorId) await this.assertVendor(dto.vendorId);
    const { assetIds, ...data } = dto;
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      data as Record<string, unknown>,
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.purchase.update({ where: { id }, data });
      if (assetIds) {
        await tx.asset.updateMany({
          where: { id: { in: assetIds }, deletedAt: null },
          data: { purchaseId: id, vendorId: dto.vendorId ?? existing.vendorId },
        });
      }
      if (changes || assetIds) {
        await this.activity.record(
          {
            actorId: user.id,
            action: 'purchase.update',
            entityType: 'purchase',
            entityId: id,
            oldValues: changes?.oldValues,
            newValues: { ...changes?.newValues, assetIds },
          },
          tx,
        );
      }
    });
    return this.get(id);
  }

  private async assertVendor(vendorId: string) {
    if (!(await this.prisma.vendor.findFirst({ where: { id: vendorId, deletedAt: null } }))) {
      throw Errors.badRequest('Vendor not found', 'vendorId');
    }
  }
}
