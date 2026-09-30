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
import { Prisma, RentalItemStatus, RentalItemType, RentalStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

export const rentalRef = (number: number) => `RNT-${String(number).padStart(6, '0')}`;

// ─── Camps ──────────────────────────────────────────────────────────────────

class CreateCampDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) code?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateCampDto extends PartialType(CreateCampDto) {}

// ─── Items ──────────────────────────────────────────────────────────────────

class CreateRentalItemDto {
  @IsUUID() campId!: string;
  @IsEnum(RentalItemType) type!: RentalItemType;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  /** Card number, machine number or serial. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) code?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) provider?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  standardCharge?: number;
  @IsOptional() @IsEnum(RentalItemStatus) status?: RentalItemStatus;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class UpdateRentalItemDto extends PartialType(CreateRentalItemDto) {}

class RentalItemQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() campId?: string;
  @IsOptional() @IsEnum(RentalItemType) type?: RentalItemType;
  @IsOptional() @IsEnum(RentalItemStatus) status?: RentalItemStatus;
}

// ─── Rentals ────────────────────────────────────────────────────────────────

class CreateRentalDto {
  @IsUUID() itemId!: string;
  @IsUUID() employeeId!: string;
  /** When the card was handed over, or the washing time starts. */
  @Type(() => Date) @IsDate() startAt!: Date;
  /** When it comes back, or the washing time ends; left out while the item is still out. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() endAt?: Date | null;
  /** Defaults to the item's usual charge. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) charge?: number;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class UpdateRentalDto {
  @IsOptional() @Type(() => Date) @IsDate() startAt?: Date;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() endAt?: Date | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) charge?: number;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class EndRentalDto {
  /** Defaults to now. */
  @IsOptional() @Type(() => Date) @IsDate() endAt?: Date;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) charge?: number;
  @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
}

class RentalQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() campId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsEnum(RentalItemType) type?: RentalItemType;
  @IsOptional() @IsEnum(RentalStatus) status?: RentalStatus;
  /** Only rentals that were running on this day. */
  @IsOptional() @Type(() => Date) @IsDate() on?: Date;
}

const itemInclude = {
  camp: { select: { id: true, name: true, code: true } },
} satisfies Prisma.RentalItemInclude;

const rentalInclude = {
  item: {
    select: {
      id: true,
      name: true,
      type: true,
      code: true,
      camp: { select: { id: true, name: true, code: true } },
    },
  },
  employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.RentalInclude;

/** Midnight to midnight around a day, in the server's time zone. */
function dayRange(date: Date): { from: Date; to: Date } {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/**
 * Camp rentals: the WiFi cards and washing machines each camp rents to its employees, and every
 * card issued or washing time recorded against them.
 */
@ApiTags('Camp rentals')
@Controller()
export class RentalsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly settings: SettingsService,
  ) {}

  // ── Camps ─────────────────────────────────────────────────────────────────

  @Get('camps')
  @RequirePermissions('rental.view', 'rental.manage')
  listCamps(@Query() q: PaginationQueryDto) {
    const where: Prisma.CampWhereInput = {
      deletedAt: null,
      ...(q.search ? { OR: searchFilter(q.search, ['name', 'code', 'location']) } : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.camp.findMany({
          where,
          orderBy: { name: 'asc' },
          include: { _count: { select: { items: { where: { deletedAt: null } } } } },
          ...page,
        }),
      () => this.prisma.camp.count({ where }),
    );
  }

  @Post('camps')
  @RequirePermissions('rental.manage')
  async createCamp(@Body() dto: CreateCampDto, @CurrentUser() user: AuthUser) {
    const camp = await this.prisma.camp.create({ data: dto });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'camp.create',
      entityType: 'camp',
      entityId: camp.id,
      newValues: dto,
    });
    return camp;
  }

  @Patch('camps/:id')
  @RequirePermissions('rental.manage')
  async updateCamp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.camp.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Camp');
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    const camp = await this.prisma.camp.update({ where: { id }, data: dto });
    if (changes)
      await this.activity.recordSafely({
        actorId: user.id,
        action: 'camp.update',
        entityType: 'camp',
        entityId: id,
        ...changes,
      });
    return camp;
  }

  @Delete('camps/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rental.manage')
  async deleteCamp(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const camp = await this.prisma.camp.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { items: { where: { deletedAt: null } } } } },
    });
    if (!camp) throw Errors.notFound('Camp');
    if (camp._count.items) throw Errors.invalidState('Move or remove the items in this camp first');
    await this.prisma.camp.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'camp.delete',
      entityType: 'camp',
      entityId: id,
      oldValues: { name: camp.name },
    });
    return { id };
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  @Get('rental-items')
  @RequirePermissions('rental.view', 'rental.manage')
  listItems(@Query() q: RentalItemQueryDto) {
    const where: Prisma.RentalItemWhereInput = {
      deletedAt: null,
      campId: q.campId,
      type: q.type,
      status: q.status,
      ...(q.search ? { OR: searchFilter(q.search, ['name', 'code', 'provider']) } : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.rentalItem.findMany({
          where,
          include: {
            ...itemInclude,
            // The rental that has it now, so the list can show who is holding it.
            rentals: {
              where: { status: 'ACTIVE' },
              orderBy: { startAt: 'desc' },
              take: 1,
              include: { employee: { select: { id: true, firstName: true, lastName: true } } },
            },
          },
          orderBy: resolveOrderBy<Prisma.RentalItemOrderByWithRelationInput>(
            q,
            {
              name: (o) => ({ name: o }),
              type: (o) => ({ type: o }),
              status: (o) => ({ status: o }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { name: 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.rentalItem.count({ where }),
    );
  }

  @Get('rental-items/:id')
  @RequirePermissions('rental.view', 'rental.manage')
  async getItem(@Param('id', ParseUUIDPipe) id: string) {
    const item = await this.prisma.rentalItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...itemInclude,
        rentals: { orderBy: { startAt: 'desc' }, take: 50, include: rentalInclude },
      },
    });
    if (!item) throw Errors.notFound('Rental item');
    return item;
  }

  @Post('rental-items')
  @RequirePermissions('rental.manage')
  async createItem(@Body() dto: CreateRentalItemDto, @CurrentUser() user: AuthUser) {
    await this.assertCamp(dto.campId);
    const { defaultCurrency } = await this.settings.get();
    const item = await this.prisma.rentalItem.create({
      data: { ...dto, currency: defaultCurrency },
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental_item.create',
      entityType: 'rental_item',
      entityId: item.id,
      newValues: dto,
    });
    return this.getItem(item.id);
  }

  @Patch('rental-items/:id')
  @RequirePermissions('rental.manage')
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.getItem(id);
    if (dto.campId) await this.assertCamp(dto.campId);
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (!changes) return existing;
    await this.prisma.rentalItem.update({
      where: { id },
      data: dto as Prisma.RentalItemUncheckedUpdateInput,
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental_item.update',
      entityType: 'rental_item',
      entityId: id,
      ...changes,
    });
    return this.getItem(id);
  }

  @Delete('rental-items/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rental.manage')
  async deleteItem(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const item = await this.getItem(id);
    if (item.rentals.some((r) => r.status === 'ACTIVE'))
      throw Errors.invalidState('This item is still out with someone');
    await this.prisma.rentalItem.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental_item.delete',
      entityType: 'rental_item',
      entityId: id,
      oldValues: { name: item.name, campId: item.campId },
    });
    return { id };
  }

  // ── Rentals ───────────────────────────────────────────────────────────────

  @Get('rentals')
  @RequirePermissions('rental.view', 'rental.manage')
  listRentals(@Query() q: RentalQueryDto) {
    const day = q.on ? dayRange(q.on) : null;
    const where: Prisma.RentalWhereInput = {
      itemId: q.itemId,
      employeeId: q.employeeId,
      status: q.status,
      ...(q.campId || q.type ? { item: { campId: q.campId, type: q.type } } : {}),
      // Running on that day: started before midnight, and had not ended when the day began.
      ...(day
        ? {
            startAt: { lt: day.to },
            OR: [{ endAt: null }, { endAt: { gt: day.from } }],
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { item: { OR: searchFilter(q.search, ['name', 'code']) } },
              {
                employee: {
                  OR: searchFilter(q.search, ['firstName', 'lastName', 'employeeNumber']),
                },
              },
            ],
          }
        : {}),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.rental.findMany({
          where,
          include: rentalInclude,
          orderBy: resolveOrderBy<Prisma.RentalOrderByWithRelationInput>(
            q,
            {
              startAt: (o) => ({ startAt: o }),
              number: (o) => ({ number: o }),
              charge: (o) => ({ charge: o }),
            },
            { startAt: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.rental.count({ where }),
    );
  }

  /**
   * Records an item going out: a WiFi card issued until it comes back (no end), or one washing
   * time (start and end). Two people cannot have the same item at the same time.
   */
  @Post('rentals')
  @RequirePermissions('rental.manage')
  async createRental(@Body() dto: CreateRentalDto, @CurrentUser() user: AuthUser) {
    const item = await this.getItem(dto.itemId);
    if (item.status === 'RETIRED' || item.status === 'UNDER_REPAIR')
      throw Errors.invalidState(
        `This item is ${item.status === 'RETIRED' ? 'retired' : 'under repair'}`,
      );
    if (
      !(await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null },
      }))
    )
      throw Errors.badRequest('Employee not found', 'employeeId');
    if (dto.endAt && dto.endAt <= dto.startAt)
      throw Errors.badRequest('The end has to come after the start', 'endAt');
    await this.assertFree(dto.itemId, dto.startAt, dto.endAt ?? null);

    const rental = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rental.create({
        data: {
          itemId: dto.itemId,
          employeeId: dto.employeeId,
          startAt: dto.startAt,
          endAt: dto.endAt ?? null,
          charge: dto.charge ?? item.standardCharge,
          currency: item.currency,
          // A finished washing time is recorded as it is; a card stays out until it comes back.
          status: dto.endAt ? 'COMPLETED' : 'ACTIVE',
          remarks: dto.remarks,
          createdById: user.id,
        },
        include: rentalInclude,
      });
      if (!dto.endAt)
        await tx.rentalItem.update({ where: { id: item.id }, data: { status: 'RENTED' } });
      return created;
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental.create',
      entityType: 'rental',
      entityId: rental.id,
      newValues: {
        ref: rentalRef(rental.number),
        item: item.name,
        camp: item.camp.name,
        employeeId: dto.employeeId,
        startAt: dto.startAt,
        endAt: dto.endAt ?? null,
      },
    });
    return rental;
  }

  /** Takes the item back: the rental is finished and the item is free again. */
  @Post('rentals/:id/end')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rental.manage')
  async endRental(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndRentalDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.findRental(id);
    if (existing.status !== 'ACTIVE') throw Errors.invalidState('This rental is already finished');
    const endAt = dto.endAt ?? new Date();
    if (endAt <= existing.startAt)
      throw Errors.badRequest('The end has to come after the start', 'endAt');

    const rental = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rental.update({
        where: { id },
        data: {
          endAt,
          status: 'COMPLETED',
          charge: dto.charge ?? undefined,
          remarks: dto.remarks ?? undefined,
        },
        include: rentalInclude,
      });
      await this.freeItem(tx, existing.itemId, id);
      return updated;
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental.end',
      entityType: 'rental',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: 'COMPLETED', endAt },
    });
    return rental;
  }

  @Patch('rentals/:id')
  @RequirePermissions('rental.manage')
  async updateRental(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.findRental(id);
    const startAt = dto.startAt ?? existing.startAt;
    const endAt = dto.endAt === undefined ? existing.endAt : dto.endAt;
    if (endAt && endAt <= startAt)
      throw Errors.badRequest('The end has to come after the start', 'endAt');
    if (dto.startAt || dto.endAt !== undefined)
      await this.assertFree(existing.itemId, startAt, endAt, id);

    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    const rental = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.rental.update({
        where: { id },
        data: {
          startAt,
          endAt,
          charge: dto.charge,
          remarks: dto.remarks,
          status: endAt ? 'COMPLETED' : 'ACTIVE',
        },
        include: rentalInclude,
      });
      if (endAt) await this.freeItem(tx, existing.itemId, id);
      else
        await tx.rentalItem.update({ where: { id: existing.itemId }, data: { status: 'RENTED' } });
      return updated;
    });
    if (changes)
      await this.activity.recordSafely({
        actorId: user.id,
        action: 'rental.update',
        entityType: 'rental',
        entityId: id,
        ...changes,
      });
    return rental;
  }

  @Delete('rentals/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rental.manage')
  async deleteRental(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.findRental(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.rental.delete({ where: { id } });
      await this.freeItem(tx, existing.itemId, id);
    });
    await this.activity.recordSafely({
      actorId: user.id,
      action: 'rental.delete',
      entityType: 'rental',
      entityId: id,
      oldValues: { ref: rentalRef(existing.number), itemId: existing.itemId },
    });
    return { id };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async findRental(id: string) {
    const rental = await this.prisma.rental.findUnique({ where: { id }, include: rentalInclude });
    if (!rental) throw Errors.notFound('Rental');
    return rental;
  }

  /** The item is free again once nothing else is still out on it. */
  private async freeItem(tx: Prisma.TransactionClient, itemId: string, excludeRentalId: string) {
    const stillOut = await tx.rental.findFirst({
      where: { itemId, status: 'ACTIVE', id: { not: excludeRentalId } },
    });
    if (!stillOut)
      await tx.rentalItem.update({
        where: { id: itemId },
        data: { status: 'AVAILABLE' },
      });
  }

  /** Refuses a period that runs into another rental of the same item (open ends run forever). */
  private async assertFree(
    itemId: string,
    startAt: Date,
    endAt: Date | null,
    excludeRentalId?: string,
  ): Promise<void> {
    const clash = await this.prisma.rental.findFirst({
      where: {
        itemId,
        status: { not: 'CANCELLED' },
        ...(excludeRentalId ? { id: { not: excludeRentalId } } : {}),
        OR: [{ endAt: null }, { endAt: { gt: startAt } }],
        ...(endAt ? { startAt: { lt: endAt } } : {}),
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    if (clash)
      throw Errors.conflict(
        'RENTAL_OVERLAP',
        `${clash.employee.firstName} ${clash.employee.lastName} already has this item for that time`,
      );
  }

  private async assertCamp(campId: string): Promise<void> {
    if (!(await this.prisma.camp.findFirst({ where: { id: campId, deletedAt: null } })))
      throw Errors.badRequest('Camp not found', 'campId');
  }
}
