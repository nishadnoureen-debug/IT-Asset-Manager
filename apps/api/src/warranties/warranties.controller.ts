import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { AssetsService } from '../assets/assets.service';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { addDays, paginate, resolveOrderBy, searchFilter, startOfDay } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

class WarrantyQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['all', 'active', 'expiring', 'expired']) state: 'all' | 'active' | 'expiring' | 'expired' = 'all';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsUUID() providerId?: string;
}

class UpdateWarrantyDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() providerId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() startDate?: Date | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() endDate?: Date | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) coverage?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(128) reference?: string | null;
}

const warrantySelect = {
  id: true,
  assetTag: true,
  name: true,
  status: true,
  serialNumber: true,
  brand: true,
  model: true,
  warrantyStartDate: true,
  warrantyEndDate: true,
  warrantyCoverage: true,
  warrantyReference: true,
  warrantyProvider: { select: { id: true, name: true } },
  assetType: { select: { name: true, category: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.AssetSelect;

@ApiTags('Warranty')
@Controller()
export class WarrantiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly settings: SettingsService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get('warranties')
  @RequirePermissions('warranty.view', 'warranty.edit')
  async list(@Query() q: WarrantyQueryDto, @CurrentUser() user: AuthUser) {
    return this.query(q, user);
  }

  @Get('warranties/expiring')
  @RequirePermissions('warranty.view', 'warranty.edit')
  expiring(@Query() q: WarrantyQueryDto, @CurrentUser() user: AuthUser) {
    return this.query(Object.assign(q, { state: 'expiring' }), user);
  }

  @Get('warranties/expired')
  @RequirePermissions('warranty.view', 'warranty.edit')
  expired(@Query() q: WarrantyQueryDto, @CurrentUser() user: AuthUser) {
    return this.query(Object.assign(q, { state: 'expired' }), user);
  }

  @Get('warranties/summary')
  @RequirePermissions('warranty.view', 'warranty.edit')
  async summary(@CurrentUser() user: AuthUser) {
    const { warrantyAlertDays } = await this.settings.get();
    const today = startOfDay();
    const base: Prisma.AssetWhereInput = {
      AND: [this.assets.scopeOrThrow(user), { deletedAt: null, status: { notIn: ['DISPOSED'] } }],
    };
    const [active, expiring, expired, none] = await Promise.all([
      this.prisma.asset.count({ where: { AND: [base, { warrantyEndDate: { gte: today } }] } }),
      this.prisma.asset.count({ where: { AND: [base, { warrantyEndDate: { gte: today, lte: addDays(today, warrantyAlertDays) } }] } }),
      this.prisma.asset.count({ where: { AND: [base, { warrantyEndDate: { lt: today } }] } }),
      this.prisma.asset.count({ where: { AND: [base, { warrantyEndDate: null }] } }),
    ]);
    return { active, expiring, expired, none, alertDays: warrantyAlertDays };
  }

  @Get('assets/:id/warranty')
  @RequirePermissions('warranty.view', 'warranty.edit', 'asset.view', 'asset.view_department', 'asset.view_own')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.assets.findVisible(id, user);
    return this.prisma.asset.findUniqueOrThrow({ where: { id }, select: warrantySelect });
  }

  @Patch('assets/:id/warranty')
  @RequirePermissions('warranty.edit')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarrantyDto, @CurrentUser() user: AuthUser) {
    const asset = await this.assets.findVisible(id, user);
    if (dto.providerId && !(await this.prisma.vendor.findFirst({ where: { id: dto.providerId, deletedAt: null } }))) {
      throw Errors.badRequest('Warranty provider not found', 'providerId');
    }
    const next = {
      warrantyProviderId: dto.providerId,
      warrantyStartDate: dto.startDate,
      warrantyEndDate: dto.endDate,
      warrantyCoverage: dto.coverage,
      warrantyReference: dto.reference,
    };
    const start = next.warrantyStartDate === undefined ? asset.warrantyStartDate : next.warrantyStartDate;
    const end = next.warrantyEndDate === undefined ? asset.warrantyEndDate : next.warrantyEndDate;
    if (start && end && end < start) throw Errors.badRequest('Warranty end date must be after the start date', 'endDate');

    const changes = diff(asset as unknown as Record<string, unknown>, next);
    if (changes) {
      await this.prisma.$transaction(async (tx) => {
        await tx.asset.update({ where: { id }, data: { ...next, updatedById: user.id } });
        await this.history.record(tx, {
          assetId: id,
          action: 'WARRANTY_UPDATED',
          performedById: user.id,
          description: end ? `Warranty until ${end.toISOString().slice(0, 10)}` : 'Warranty cleared',
        });
        await this.activity.record({ actorId: user.id, action: 'warranty.update', entityType: 'asset', entityId: id, ...changes }, tx);
      });
    }
    return this.get(id, user);
  }

  private async query(q: WarrantyQueryDto, user: AuthUser) {
    const today = startOfDay();
    const days = q.days ?? (await this.settings.get()).warrantyAlertDays;
    const state: Record<string, Prisma.AssetWhereInput> = {
      all: { warrantyEndDate: { not: null } },
      active: { warrantyEndDate: { gte: today } },
      expiring: { warrantyEndDate: { gte: today, lte: addDays(today, days) } },
      expired: { warrantyEndDate: { lt: today } },
    };
    const where: Prisma.AssetWhereInput = {
      AND: [
        this.assets.scopeOrThrow(user),
        { deletedAt: null, status: { notIn: ['DISPOSED'] }, warrantyProviderId: q.providerId },
        state[q.state],
        q.search ? { OR: searchFilter(q.search, ['assetTag', 'name', 'serialNumber', 'warrantyReference']) } : {},
      ],
    };
    return paginate(
      q,
      (page) =>
        this.prisma.asset.findMany({
          where,
          select: warrantySelect,
          orderBy: resolveOrderBy<Prisma.AssetOrderByWithRelationInput>(
            q,
            { warrantyEndDate: (o) => ({ warrantyEndDate: o }), assetTag: (o) => ({ assetTag: o }) },
            { warrantyEndDate: q.state === 'expired' ? 'desc' : 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.asset.count({ where }),
    );
  }
}
