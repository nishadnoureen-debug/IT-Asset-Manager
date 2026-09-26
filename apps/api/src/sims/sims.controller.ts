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
import { Prisma, SimStatus } from '@prisma/client';
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
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { trim } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const money = () => [IsOptional(), Type(() => Number), IsNumber({ maxDecimalPlaces: 2 }), Min(0)];
/** Charge columns of a usage row, in the order they appear on the screen. */
const CHARGE_FIELDS = [
  'monthlyCharge',
  'excessUsage',
  'internationalCharges',
  'roamingCharges',
  'parkingCharges',
] as const;

// ─── Rate plans ─────────────────────────────────────────────────────────────

class CreateSimPlanDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) provider?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyCharge?: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateSimPlanDto extends PartialType(CreateSimPlanDto) {}

// ─── SIM cards ──────────────────────────────────────────────────────────────

class CreateSimCardDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(40) phoneNumber!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) simNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) provider?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() planId?: string | null;
  @IsOptional() @IsEnum(SimStatus) status?: SimStatus;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() employeeId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assetId?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  activatedAt?: Date | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  cancelledAt?: Date | null;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class UpdateSimCardDto extends PartialType(CreateSimCardDto) {}

class SimCardQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(SimStatus) status?: SimStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unassigned?: boolean;
}

// ─── Monthly usage ──────────────────────────────────────────────────────────

class SimUsageDto {
  /** Billing month; any day is accepted and stored as the first of that month. */
  @Type(() => Date) @IsDate() period!: Date;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() planId?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyCharge?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) excessUsage?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  internationalCharges?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  roamingCharges?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  parkingCharges?: number;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class UpdateSimUsageDto extends PartialType(SimUsageDto) {}

class SimUsageQueryDto extends PaginationQueryDto {
  /** Any day inside the billing month to list. */
  @IsOptional() @Type(() => Date) @IsDate() period?: Date;
  @IsOptional() @IsUUID() simCardId?: string;
  @IsOptional() @IsUUID() planId?: string;
}

const cardInclude = {
  plan: { select: { id: true, name: true, monthlyCharge: true, currency: true } },
  employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  asset: { select: { id: true, assetTag: true, name: true } },
} satisfies Prisma.SimCardInclude;

const usageInclude = {
  simCard: {
    select: {
      id: true,
      phoneNumber: true,
      status: true,
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  plan: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SimUsageInclude;

/** First day of the month the date falls in, as a plain date. */
function billingMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Company SIM cards: the carrier rate plans, the lines themselves, and what each line cost in a
 * given month (monthly charge, excess usage, international, roaming and parking).
 */
@ApiTags('SIM cards')
@Controller()
export class SimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  // ── Rate plans ────────────────────────────────────────────────────────────

  @Get('sim-plans')
  @RequirePermissions('sim.view', 'sim.manage')
  list_plans(@Query() q: PaginationQueryDto) {
    const where: Prisma.SimPlanWhereInput = {
      deletedAt: null,
      ...(q.search ? { OR: searchFilter(q.search, ['name', 'provider']) } : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.simPlan.findMany({
          where,
          orderBy: resolveOrderBy<Prisma.SimPlanOrderByWithRelationInput>(
            q,
            {
              name: (o) => ({ name: o }),
              monthlyCharge: (o) => ({ monthlyCharge: o }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { name: 'asc' },
          ),
          include: { _count: { select: { simCards: { where: { deletedAt: null } } } } },
          ...page,
        }),
      () => this.prisma.simPlan.count({ where }),
    );
  }

  @Post('sim-plans')
  @RequirePermissions('sim.manage')
  async createPlan(@Body() dto: CreateSimPlanDto, @CurrentUser() user: AuthUser) {
    const { defaultCurrency } = await this.settings.get();
    const plan = await this.prisma.simPlan.create({
      data: { ...dto, currency: dto.currency ?? defaultCurrency },
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_plan.create',
      entityType: 'sim_plan',
      entityId: plan.id,
      newValues: dto,
    });
    return plan;
  }

  @Patch('sim-plans/:id')
  @RequirePermissions('sim.manage')
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSimPlanDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.simPlan.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Rate plan');
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    const plan = await this.prisma.simPlan.update({ where: { id }, data: dto });
    if (changes)
      await this.activity.recordSafely({
        actorId: user.id,
        action: 'sim_plan.update',
        entityType: 'sim_plan',
        entityId: id,
        ...changes,
      });
    return plan;
  }

  @Delete('sim-plans/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sim.manage')
  async deletePlan(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const plan = await this.prisma.simPlan.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { simCards: { where: { deletedAt: null } } } } },
    });
    if (!plan) throw Errors.notFound('Rate plan');
    if (plan._count.simCards)
      throw Errors.invalidState('Move the SIM cards on this plan to another plan first');
    await this.prisma.simPlan.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_plan.delete',
      entityType: 'sim_plan',
      entityId: id,
      oldValues: { name: plan.name },
    });
    return { id };
  }

  // ── SIM cards ─────────────────────────────────────────────────────────────

  @Get('sim-cards')
  @RequirePermissions('sim.view', 'sim.manage')
  list(@Query() q: SimCardQueryDto) {
    const where: Prisma.SimCardWhereInput = {
      deletedAt: null,
      status: q.status,
      planId: q.planId,
      employeeId: q.unassigned ? null : q.employeeId,
      ...(q.search
        ? { OR: searchFilter(q.search, ['phoneNumber', 'simNumber', 'provider', 'remarks']) }
        : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.simCard.findMany({
          where,
          include: {
            ...cardInclude,
            // The newest month, so the list can show the latest bill.
            usages: { orderBy: { period: 'desc' }, take: 1 },
          },
          orderBy: resolveOrderBy<Prisma.SimCardOrderByWithRelationInput>(
            q,
            {
              phoneNumber: (o) => ({ phoneNumber: o }),
              status: (o) => ({ status: o }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { phoneNumber: 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.simCard.count({ where }),
    );
  }

  @Get('sim-cards/:id')
  @RequirePermissions('sim.view', 'sim.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const card = await this.prisma.simCard.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...cardInclude,
        usages: {
          orderBy: { period: 'desc' },
          take: 24,
          include: { plan: { select: { name: true } } },
        },
      },
    });
    if (!card) throw Errors.notFound('SIM card');
    return card;
  }

  @Post('sim-cards')
  @RequirePermissions('sim.manage')
  async create(@Body() dto: CreateSimCardDto, @CurrentUser() user: AuthUser) {
    await this.assertReferences(dto);
    const card = await this.prisma.simCard.create({
      data: dto as Prisma.SimCardUncheckedCreateInput,
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_card.create',
      entityType: 'sim_card',
      entityId: card.id,
      newValues: dto,
    });
    return this.get(card.id);
  }

  @Patch('sim-cards/:id')
  @RequirePermissions('sim.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSimCardDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.get(id);
    await this.assertReferences(dto);
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (!changes) return existing;
    await this.prisma.simCard.update({
      where: { id },
      data: dto as Prisma.SimCardUncheckedUpdateInput,
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_card.update',
      entityType: 'sim_card',
      entityId: id,
      ...changes,
    });
    return this.get(id);
  }

  @Delete('sim-cards/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sim.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const card = await this.get(id);
    await this.prisma.simCard.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_card.delete',
      entityType: 'sim_card',
      entityId: id,
      oldValues: { phoneNumber: card.phoneNumber },
    });
    return { id };
  }

  // ── Monthly usage ─────────────────────────────────────────────────────────

  @Get('sim-usages')
  @RequirePermissions('sim.view', 'sim.manage')
  async usages(@Query() q: SimUsageQueryDto) {
    const where: Prisma.SimUsageWhereInput = {
      simCardId: q.simCardId,
      planId: q.planId,
      period: q.period ? billingMonth(q.period) : undefined,
      ...(q.search
        ? { simCard: { OR: searchFilter(q.search, ['phoneNumber', 'simNumber']) } }
        : {}),
    };
    const page = await paginate(
      q,
      (p) =>
        this.prisma.simUsage.findMany({
          where,
          include: usageInclude,
          orderBy: resolveOrderBy<Prisma.SimUsageOrderByWithRelationInput>(
            q,
            {
              period: (o) => ({ period: o }),
              totalCharge: (o) => ({ totalCharge: o }),
              phoneNumber: (o) => ({ simCard: { phoneNumber: o } }),
            },
            { period: 'desc' },
          ),
          ...p,
        }),
      () => this.prisma.simUsage.count({ where }),
    );
    const totals = await this.prisma.simUsage.aggregate({
      where,
      _sum: {
        monthlyCharge: true,
        excessUsage: true,
        internationalCharges: true,
        roamingCharges: true,
        parkingCharges: true,
        totalCharge: true,
      },
    });
    // Column totals ride along in meta, next to the paging numbers.
    Object.assign(page.meta, { totals: totals._sum });
    return page;
  }

  @Post('sim-cards/:id/usages')
  @RequirePermissions('sim.manage')
  async addUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimUsageDto,
    @CurrentUser() user: AuthUser,
  ) {
    const card = await this.get(id);
    const period = billingMonth(dto.period);
    if (
      await this.prisma.simUsage.findUnique({
        where: { simCardId_period: { simCardId: id, period } },
      })
    )
      throw Errors.conflict('USAGE_EXISTS', 'This month is already recorded for this SIM');
    const { defaultCurrency } = await this.settings.get();
    const planId = dto.planId === undefined ? card.planId : dto.planId;
    const charges = this.charges(dto, {
      monthlyCharge: Number(card.plan?.monthlyCharge ?? 0),
    });
    const usage = await this.prisma.simUsage.create({
      data: {
        simCardId: id,
        period,
        planId,
        ...charges,
        currency: card.plan?.currency ?? defaultCurrency,
        remarks: dto.remarks,
        recordedById: user.id,
      },
      include: usageInclude,
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_usage.create',
      entityType: 'sim_usage',
      entityId: usage.id,
      newValues: { phoneNumber: card.phoneNumber, period, ...charges },
    });
    return usage;
  }

  @Patch('sim-usages/:id')
  @RequirePermissions('sim.manage')
  async updateUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSimUsageDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.simUsage.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Usage record');
    const charges = this.charges(dto, {
      monthlyCharge: Number(existing.monthlyCharge),
      excessUsage: Number(existing.excessUsage),
      internationalCharges: Number(existing.internationalCharges),
      roamingCharges: Number(existing.roamingCharges),
      parkingCharges: Number(existing.parkingCharges),
    });
    const usage = await this.prisma.simUsage.update({
      where: { id },
      data: {
        ...charges,
        planId: dto.planId === undefined ? undefined : dto.planId,
        period: dto.period ? billingMonth(dto.period) : undefined,
        remarks: dto.remarks,
      },
      include: usageInclude,
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_usage.update',
      entityType: 'sim_usage',
      entityId: id,
      oldValues: { totalCharge: existing.totalCharge },
      newValues: charges,
    });
    return usage;
  }

  @Delete('sim-usages/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sim.manage')
  async deleteUsage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.prisma.simUsage.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Usage record');
    await this.prisma.simUsage.delete({ where: { id } });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_usage.delete',
      entityType: 'sim_usage',
      entityId: id,
      oldValues: { period: existing.period, totalCharge: existing.totalCharge },
    });
    return { id };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Charge columns with the total kept in step (the database checks it as well). */
  private charges(
    dto: Partial<Record<(typeof CHARGE_FIELDS)[number], number>>,
    fallback: Partial<Record<(typeof CHARGE_FIELDS)[number], number>>,
  ) {
    const values = Object.fromEntries(
      CHARGE_FIELDS.map((field) => [field, dto[field] ?? fallback[field] ?? 0]),
    ) as Record<(typeof CHARGE_FIELDS)[number], number>;
    const totalCharge = CHARGE_FIELDS.reduce((sum, field) => sum + values[field], 0);
    return { ...values, totalCharge: Math.round(totalCharge * 100) / 100 };
  }

  private async assertReferences(dto: Partial<CreateSimCardDto>): Promise<void> {
    if (
      dto.planId &&
      !(await this.prisma.simPlan.findFirst({ where: { id: dto.planId, deletedAt: null } }))
    )
      throw Errors.badRequest('Rate plan not found', 'planId');
    if (
      dto.employeeId &&
      !(await this.prisma.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null } }))
    )
      throw Errors.badRequest('Employee not found', 'employeeId');
    if (
      dto.assetId &&
      !(await this.prisma.asset.findFirst({ where: { id: dto.assetId, deletedAt: null } }))
    )
      throw Errors.badRequest('Asset not found', 'assetId');
  }
}
