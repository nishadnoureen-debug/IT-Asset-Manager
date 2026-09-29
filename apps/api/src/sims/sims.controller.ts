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
import { ApiTags, PartialType } from '@nestjs/swagger';
import { AssetCategory, Prisma, SimStatus, SimSwapReason } from '@prisma/client';
import type { Response } from 'express';
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
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SimSwapPdfService, swapRef } from './sim-swap-pdf.service';

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

// ─── Swaps ──────────────────────────────────────────────────────────────────

class CreateSimSwapDto {
  /** Holder the line is moving to; leave empty to take it back into stock. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() toEmployeeId?: string | null;
  /**
   * Holder the line is coming from. Defaults to whoever holds it now, so the form shows the same
   * handover the records do.
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() fromEmployeeId?: string | null;
  @IsOptional() @IsEnum(SimSwapReason) reason?: SimSwapReason;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reasonDetail?: string;
  /** ICCID of the replacement SIM, when the physical card is changed too. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) newSimNumber?: string;
  @IsOptional() @Type(() => Date) @IsDate() swappedAt?: Date;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class TransferSimDto {
  /** The employee the line moves to. */
  @IsUUID() toEmployeeId!: string;
  /**
   * The device the line goes into. Left out, the employee's own device is used (their phone or
   * tablet, otherwise the asset they hold); null leaves the line out of any device.
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assetId?: string | null;
  @IsOptional() @Type(() => Date) @IsDate() transferredAt?: Date;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class SimSwapQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() simCardId?: string;
  @IsOptional() @IsEnum(SimSwapReason) reason?: SimSwapReason;
  @IsOptional() @IsUUID() employeeId?: string;
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

/** The two sides of a swap and who recorded it; the line itself is added when it is not obvious. */
const swapPeople = {
  fromEmployee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  toEmployee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  asset: { select: { id: true, assetTag: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SimSwapInclude;

const swapInclude = {
  ...swapPeople,
  simCard: { select: { id: true, phoneNumber: true, simNumber: true, provider: true } },
} satisfies Prisma.SimSwapInclude;

/** Phones and tablets are the devices a SIM normally goes into. */
const PHONE_CATEGORIES: AssetCategory[] = ['MOBILE', 'TABLET'];

/** First day of the month the date falls in, as a plain date. */
function billingMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Company SIM cards: the carrier rate plans, the lines themselves, what each line cost in a given
 * month (monthly charge, excess usage, international, roaming and parking), and the swaps that move
 * a line from one holder to another — each with its printable swap request form.
 */
@ApiTags('SIM cards')
@Controller()
export class SimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
    private readonly swapPdf: SimSwapPdfService,
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
        swaps: { orderBy: { swappedAt: 'desc' }, take: 24, include: swapPeople },
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

  // ── Swaps ─────────────────────────────────────────────────────────────────

  @Get('sim-swaps')
  @RequirePermissions('sim.view', 'sim.manage')
  listSwaps(@Query() q: SimSwapQueryDto) {
    const where: Prisma.SimSwapWhereInput = {
      simCardId: q.simCardId,
      reason: q.reason,
      ...(q.employeeId
        ? { OR: [{ fromEmployeeId: q.employeeId }, { toEmployeeId: q.employeeId }] }
        : {}),
      ...(q.search
        ? { simCard: { OR: searchFilter(q.search, ['phoneNumber', 'simNumber']) } }
        : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.simSwap.findMany({
          where,
          include: swapInclude,
          orderBy: resolveOrderBy<Prisma.SimSwapOrderByWithRelationInput>(
            q,
            {
              swappedAt: (o) => ({ swappedAt: o }),
              number: (o) => ({ number: o }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { swappedAt: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.simSwap.count({ where }),
    );
  }

  /**
   * Swaps the line over: records who handed it over and who received it, moves the SIM to the new
   * holder and, when a replacement card was issued, puts its ICCID on the line.
   */
  @Post('sim-cards/:id/swaps')
  @RequirePermissions('sim.manage')
  async createSwap(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSimSwapDto,
    @CurrentUser() user: AuthUser,
  ) {
    const card = await this.get(id);
    const fromEmployeeId = dto.fromEmployeeId === undefined ? card.employeeId : dto.fromEmployeeId;
    const toEmployeeId = dto.toEmployeeId ?? null;
    if (!fromEmployeeId && !toEmployeeId && !dto.newSimNumber)
      throw Errors.badRequest(
        'Say who is receiving the line, or which SIM replaces it',
        'toEmployeeId',
      );
    for (const [field, employeeId] of [
      ['fromEmployeeId', fromEmployeeId],
      ['toEmployeeId', toEmployeeId],
    ] as const)
      if (
        employeeId &&
        !(await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } }))
      )
        throw Errors.badRequest('Employee not found', field);
    if (
      dto.newSimNumber &&
      (await this.prisma.simCard.findFirst({
        where: { simNumber: dto.newSimNumber, id: { not: id }, deletedAt: null },
      }))
    )
      throw Errors.conflict('SIM_IN_USE', 'Another line already has this SIM number');

    const swap = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simSwap.create({
        data: {
          simCardId: id,
          fromEmployeeId,
          toEmployeeId,
          reason: dto.reason,
          reasonDetail: dto.reasonDetail,
          newSimNumber: dto.newSimNumber,
          previousSimNumber: card.simNumber,
          // A swap leaves the line in the device it is already in.
          assetId: card.assetId,
          previousAssetId: card.assetId,
          swappedAt: dto.swappedAt ?? new Date(),
          remarks: dto.remarks,
          createdById: user.id,
        },
        include: swapInclude,
      });
      await tx.simCard.update({
        where: { id },
        data: {
          employeeId: toEmployeeId,
          simNumber: dto.newSimNumber ?? undefined,
          // A line nobody holds any more goes back to stock.
          status: toEmployeeId ? 'ACTIVE' : card.status === 'ACTIVE' ? 'SPARE' : card.status,
        },
      });
      return created;
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_swap.create',
      entityType: 'sim_swap',
      entityId: swap.id,
      oldValues: { employeeId: card.employeeId, simNumber: card.simNumber },
      newValues: {
        ref: swapRef(swap.number),
        phoneNumber: card.phoneNumber,
        toEmployeeId,
        reason: swap.reason,
        newSimNumber: dto.newSimNumber,
      },
    });
    return swap;
  }

  /**
   * Undoes a swap that should not have been recorded: the line goes back to the holder and the SIM
   * number it had before. Only the newest swap on a line can be undone, so the history stays in the
   * order it happened.
   */
  @Delete('sim-swaps/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sim.manage')
  async removeSwap(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const swap = await this.prisma.simSwap.findUnique({
      where: { id },
      include: { simCard: true },
    });
    if (!swap) throw Errors.notFound('SIM swap');
    const newer = await this.prisma.simSwap.findFirst({
      where: {
        simCardId: swap.simCardId,
        id: { not: id },
        OR: [
          { swappedAt: { gt: swap.swappedAt } },
          { swappedAt: swap.swappedAt, createdAt: { gt: swap.createdAt } },
        ],
      },
    });
    if (newer) throw Errors.invalidState('Undo the newer swaps on this line first');
    // The SIM number can only go back if no other line has taken it in the meantime.
    if (
      swap.newSimNumber &&
      swap.previousSimNumber &&
      (await this.prisma.simCard.findFirst({
        where: { simNumber: swap.previousSimNumber, id: { not: swap.simCardId }, deletedAt: null },
      }))
    )
      throw Errors.conflict('SIM_IN_USE', 'Another line now has the SIM number this swap replaced');

    await this.prisma.$transaction(async (tx) => {
      await tx.simCard.update({
        where: { id: swap.simCardId },
        data: {
          employeeId: swap.fromEmployeeId,
          // Only touch the SIM number and the device if this swap was what changed them.
          ...(swap.newSimNumber ? { simNumber: swap.previousSimNumber } : {}),
          ...(swap.assetId !== swap.previousAssetId ? { assetId: swap.previousAssetId } : {}),
          status: swap.fromEmployeeId
            ? 'ACTIVE'
            : swap.simCard.status === 'ACTIVE'
              ? 'SPARE'
              : swap.simCard.status,
        },
      });
      await tx.simSwap.delete({ where: { id } });
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_swap.delete',
      entityType: 'sim_swap',
      entityId: id,
      oldValues: {
        ref: swapRef(swap.number),
        phoneNumber: swap.simCard.phoneNumber,
        toEmployeeId: swap.toEmployeeId,
        reason: swap.reason,
      },
      newValues: {
        employeeId: swap.fromEmployeeId,
        simNumber: swap.previousSimNumber,
        assetId: swap.previousAssetId,
      },
    });
    return { id };
  }

  /**
   * Transfers the line to another employee, the way an asset is transferred: it becomes theirs and
   * moves into their device — their phone or tablet, otherwise the asset they hold — unless another
   * device (or none) is named. The move is kept in the line's history and can be undone.
   */
  @Post('sim-cards/:id/transfer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sim.manage')
  async transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferSimDto,
    @CurrentUser() user: AuthUser,
  ) {
    const card = await this.get(id);
    if (
      !(await this.prisma.employee.findFirst({
        where: { id: dto.toEmployeeId, deletedAt: null },
      }))
    )
      throw Errors.badRequest('Employee not found', 'toEmployeeId');
    if (
      dto.assetId &&
      !(await this.prisma.asset.findFirst({ where: { id: dto.assetId, deletedAt: null } }))
    )
      throw Errors.badRequest('Asset not found', 'assetId');
    // No device named: the line follows the employee into the device they hold.
    const assetId = dto.assetId === undefined ? await this.deviceOf(dto.toEmployeeId) : dto.assetId;

    const swap = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simSwap.create({
        data: {
          simCardId: id,
          fromEmployeeId: card.employeeId,
          toEmployeeId: dto.toEmployeeId,
          reason: 'TRANSFER',
          previousSimNumber: card.simNumber,
          assetId,
          previousAssetId: card.assetId,
          swappedAt: dto.transferredAt ?? new Date(),
          remarks: dto.remarks,
          createdById: user.id,
        },
        include: swapInclude,
      });
      await tx.simCard.update({
        where: { id },
        data: { employeeId: dto.toEmployeeId, assetId, status: 'ACTIVE' },
      });
      return created;
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'sim_card.transfer',
      entityType: 'sim_card',
      entityId: id,
      oldValues: { employeeId: card.employeeId, assetId: card.assetId },
      newValues: {
        ref: swapRef(swap.number),
        phoneNumber: card.phoneNumber,
        employeeId: dto.toEmployeeId,
        assetId,
      },
    });
    return swap;
  }

  /** The printed SIM CARD SWAP REQUEST FORM, generated from the record for physical signatures. */
  @Get('sim-swaps/:id/form')
  @SkipEnvelope()
  @RequirePermissions('sim.view', 'sim.manage')
  async swapForm(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const swap = await this.prisma.simSwap.findUnique({ where: { id }, select: { number: true } });
    if (!swap) throw Errors.notFound('SIM swap');
    const ref = swapRef(swap.number);
    const pdf = await this.swapPdf.render(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="sim-card-swap-${ref}.pdf"`,
    });
    return new StreamableFile(pdf);
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

  /** The device an employee holds: their phone or tablet, otherwise their newest asset. */
  private async deviceOf(employeeId: string): Promise<string | null> {
    const held = await this.prisma.assetAssignment.findMany({
      where: { employeeId, status: 'ACTIVE', asset: { deletedAt: null } },
      orderBy: { assignedAt: 'desc' },
      select: { assetId: true, asset: { select: { assetType: { select: { category: true } } } } },
    });
    const phone = held.find((a) => PHONE_CATEGORIES.includes(a.asset.assetType.category));
    return (phone ?? held[0])?.assetId ?? null;
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
