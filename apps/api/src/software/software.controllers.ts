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
import { ApiTags, PartialType } from '@nestjs/swagger';
import { LicenseType, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
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
  ValidateIf,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { trim, upper } from '../assets/assets.dto';
import { can, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CryptoService, maskSecret } from '../common/crypto/crypto.service';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  addDays,
  paginate,
  resolveOrderBy,
  searchFilter,
  startOfDay,
} from '../common/query/list-query';
import { documentSelect } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

// ─── Software catalogue ─────────────────────────────────────────────────────

class CreateSoftwareDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) version?: string;
  @IsOptional() @IsUUID() publisherId?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateSoftwareDto extends PartialType(CreateSoftwareDto) {}

@ApiTags('Software')
@Controller('software')
export class SoftwareController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @RequirePermissions('software.view', 'software.manage')
  list(@Query() q: PaginationQueryDto) {
    const where: Prisma.SoftwareWhereInput = {
      deletedAt: null,
      OR: searchFilter(q.search, ['name', 'version', 'category', 'publisher.name']),
    };
    return paginate(
      q,
      async (page) => {
        const rows = await this.prisma.software.findMany({
          where,
          include: {
            publisher: { select: { id: true, name: true } },
            licenses: {
              where: { deletedAt: null },
              select: {
                id: true,
                seats: true,
                _count: { select: { assignments: { where: { unassignedAt: null } } } },
              },
            },
          },
          orderBy: resolveOrderBy<Prisma.SoftwareOrderByWithRelationInput>(
            q,
            { name: (o) => ({ name: o }), createdAt: (o) => ({ createdAt: o }) },
            { name: 'asc' },
          ),
          ...page,
        });
        return rows.map(({ licenses, ...s }) => ({
          ...s,
          licenseCount: licenses.length,
          totalSeats: licenses.some((l) => l.seats === null)
            ? null
            : licenses.reduce((sum, l) => sum + (l.seats ?? 0), 0),
          usedSeats: licenses.reduce((sum, l) => sum + l._count.assignments, 0),
        }));
      },
      () => this.prisma.software.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions('software.view', 'software.manage')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const software = await this.prisma.software.findFirst({
      where: { id, deletedAt: null },
      include: {
        publisher: { select: { id: true, name: true } },
        licenses: {
          where: { deletedAt: null },
          include: { _count: { select: { assignments: { where: { unassignedAt: null } } } } },
          orderBy: { expiryDate: { sort: 'asc', nulls: 'last' } },
        },
      },
    });
    if (!software) throw Errors.notFound('Software');
    return {
      ...software,
      licenses: software.licenses.map(({ licenseKeyEncrypted, ...l }) => ({
        ...l,
        hasLicenseKey: !!licenseKeyEncrypted,
      })),
    };
  }

  @Post()
  @RequirePermissions('software.manage')
  create(@Body() dto: CreateSoftwareDto, @CurrentUser() user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const software = await tx.software.create({ data: dto });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'software.create',
          entityType: 'software',
          entityId: software.id,
          newValues: dto,
        },
        tx,
      );
      return software;
    });
  }

  @Patch(':id')
  @RequirePermissions('software.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSoftwareDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.software.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw Errors.notFound('Software');
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    return this.prisma.$transaction(async (tx) => {
      const software = await tx.software.update({ where: { id }, data: dto });
      if (changes)
        await this.activity.record(
          {
            actorId: user.id,
            action: 'software.update',
            entityType: 'software',
            entityId: id,
            ...changes,
          },
          tx,
        );
      return software;
    });
  }
}

// ─── Licenses ───────────────────────────────────────────────────────────────

class CreateLicenseDto {
  @IsUUID() softwareId!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) name?: string;
  @IsEnum(LicenseType) licenseType!: LicenseType;
  /** Plain licence key — encrypted before storage and never returned unless explicitly revealed. */
  @IsOptional() @IsString() @MaxLength(2000) licenseKey?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  seats?: number | null;
  @IsOptional() @IsBoolean() allowOverAllocation?: boolean;
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @Type(() => Date) @IsDate() purchaseDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() startDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() expiryDate?: Date;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cost?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}
class UpdateLicenseDto extends PartialType(CreateLicenseDto) {}

class LicenseQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() softwareId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) expiringDays?: number;
}

class AssignLicenseDto {
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class UnassignLicenseDto {
  @IsUUID() assignmentId!: string;
}

class RevealQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  reveal?: boolean;
}

const licenseInclude = {
  software: { select: { id: true, name: true, version: true } },
  vendor: { select: { id: true, name: true } },
  purchase: { select: { id: true, orderNumber: true } },
  _count: { select: { assignments: { where: { unassignedAt: null } } } },
} satisfies Prisma.SoftwareLicenseInclude;

type LicenseRow = Prisma.SoftwareLicenseGetPayload<{ include: typeof licenseInclude }>;

@ApiTags('Licenses')
@Controller('licenses')
export class LicensesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly crypto: CryptoService,
    private readonly history: AssetHistoryService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @RequirePermissions('license.view', 'license.manage')
  list(@Query() q: LicenseQueryDto) {
    return this.query(q);
  }

  @Get('expiring')
  @RequirePermissions('license.view', 'license.manage')
  async expiring(@Query() q: LicenseQueryDto) {
    q.expiringDays ??= (await this.settings.get()).licenseAlertDays;
    return this.query(q);
  }

  @Get(':id')
  @RequirePermissions('license.view', 'license.manage')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: RevealQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const license = await this.prisma.softwareLicense.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...licenseInclude,
        assignments: {
          orderBy: { assignedAt: 'desc' },
          include: {
            asset: { select: { id: true, assetTag: true, name: true } },
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeNumber: true },
            },
            assignedBy: { select: { id: true, displayName: true } },
          },
        },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
    if (!license) throw Errors.notFound('License');
    const presented = this.present(license);
    if (q.reveal) {
      if (!can(user, 'license.manage'))
        throw Errors.forbidden('Only licence managers can reveal licence keys');
      await this.activity.record({
        actorId: user.id,
        action: 'license.reveal_key',
        entityType: 'software_license',
        entityId: id,
      });
      return {
        ...presented,
        licenseKey: license.licenseKeyEncrypted
          ? this.crypto.decrypt(license.licenseKeyEncrypted)
          : null,
      };
    }
    return presented;
  }

  @Post()
  @RequirePermissions('license.manage')
  async create(@Body() dto: CreateLicenseDto, @CurrentUser() user: AuthUser) {
    await this.assertRefs(dto);
    const { licenseKey, ...data } = dto;
    const { defaultCurrency } = await this.settings.get();
    const created = await this.prisma.$transaction(async (tx) => {
      const license = await tx.softwareLicense.create({
        data: {
          ...data,
          currency: data.cost !== undefined ? (data.currency ?? defaultCurrency) : data.currency,
          licenseKeyEncrypted: licenseKey ? this.crypto.encrypt(licenseKey) : undefined,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'license.create',
          entityType: 'software_license',
          entityId: license.id,
          newValues: { ...data, licenseKey: licenseKey ? '[REDACTED]' : undefined },
        },
        tx,
      );
      return license;
    });
    return this.get(created.id, {}, user);
  }

  @Patch(':id')
  @RequirePermissions('license.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLicenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.softwareLicense.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { assignments: { where: { unassignedAt: null } } } } },
    });
    if (!existing) throw Errors.notFound('License');
    await this.assertRefs(dto);
    if (
      dto.seats !== undefined &&
      dto.seats !== null &&
      dto.seats < existing._count.assignments &&
      !(dto.allowOverAllocation ?? existing.allowOverAllocation)
    ) {
      throw Errors.invalidState(
        `${existing._count.assignments} seats are in use; unassign some before reducing to ${dto.seats}`,
      );
    }
    const { licenseKey, ...data } = dto;
    const { _count, licenseKeyEncrypted, ...before } = existing;
    const changes = diff(before as Record<string, unknown>, data as Record<string, unknown>);
    await this.prisma.$transaction(async (tx) => {
      await tx.softwareLicense.update({
        where: { id },
        data: {
          ...data,
          licenseKeyEncrypted:
            licenseKey !== undefined
              ? licenseKey
                ? this.crypto.encrypt(licenseKey)
                : null
              : undefined,
        },
      });
      if (changes || licenseKey !== undefined) {
        await this.activity.record(
          {
            actorId: user.id,
            action: 'license.update',
            entityType: 'software_license',
            entityId: id,
            oldValues: changes?.oldValues,
            newValues: {
              ...changes?.newValues,
              licenseKey: licenseKey !== undefined ? '[CHANGED]' : undefined,
            },
          },
          tx,
        );
      }
    });
    return this.get(id, {}, user);
  }

  @Post(':id/assign')
  @RequirePermissions('license.assign', 'license.manage')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLicenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!!dto.assetId === !!dto.employeeId)
      throw Errors.badRequest('Assign to exactly one asset or one employee', 'assetId');
    if (
      dto.assetId &&
      !(await this.prisma.asset.findFirst({
        where: { id: dto.assetId, deletedAt: null, status: { notIn: ['DISPOSED'] } },
      }))
    ) {
      throw Errors.badRequest('Asset not found', 'assetId');
    }
    if (
      dto.employeeId &&
      !(await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null, status: { not: 'TERMINATED' } },
      }))
    ) {
      throw Errors.badRequest('Employee not found', 'employeeId');
    }

    const assignment = await this.prisma.$transaction(async (tx) => {
      // Lock the licence row so concurrent allocations cannot both take the last seat.
      const [license] = await tx.$queryRaw<
        {
          id: string;
          seats: number | null;
          allow_over_allocation: boolean;
          expiry_date: Date | null;
        }[]
      >`
        SELECT id, seats, allow_over_allocation, expiry_date FROM software_licenses
        WHERE id = ${id}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!license) throw Errors.notFound('License');
      if (license.expiry_date && license.expiry_date < startOfDay())
        throw Errors.invalidState('This licence has expired');
      const used = await tx.softwareAssignment.count({
        where: { licenseId: id, unassignedAt: null },
      });
      if (license.seats !== null && used >= license.seats && !license.allow_over_allocation) {
        throw Errors.conflict(
          'LICENSE_SEATS_EXHAUSTED',
          `All ${license.seats} seats are allocated`,
          { seats: license.seats, used },
        );
      }
      const created = await tx.softwareAssignment.create({
        data: {
          licenseId: id,
          assetId: dto.assetId,
          employeeId: dto.employeeId,
          notes: dto.notes,
          assignedById: user.id,
        },
      });
      if (dto.assetId) {
        await this.history.record(tx, {
          assetId: dto.assetId,
          action: 'SOFTWARE_ASSIGNED',
          performedById: user.id,
          metadata: { licenseId: id, softwareAssignmentId: created.id },
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'license.assign',
          entityType: 'software_license',
          entityId: id,
          newValues: { ...dto, softwareAssignmentId: created.id },
        },
        tx,
      );
      return created;
    });
    return assignment;
  }

  @Post(':id/unassign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('license.assign', 'license.manage')
  async unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnassignLicenseDto,
    @CurrentUser() user: AuthUser,
  ) {
    const assignment = await this.prisma.softwareAssignment.findFirst({
      where: { id: dto.assignmentId, licenseId: id },
    });
    if (!assignment) throw Errors.notFound('Licence assignment');
    if (assignment.unassignedAt) throw Errors.invalidState('This seat is already released');
    await this.prisma.$transaction(async (tx) => {
      await tx.softwareAssignment.update({
        where: { id: assignment.id },
        data: { unassignedAt: new Date(), unassignedById: user.id },
      });
      if (assignment.assetId) {
        await this.history.record(tx, {
          assetId: assignment.assetId,
          action: 'SOFTWARE_UNASSIGNED',
          performedById: user.id,
          metadata: { licenseId: id, softwareAssignmentId: assignment.id },
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'license.unassign',
          entityType: 'software_license',
          entityId: id,
          newValues: dto,
        },
        tx,
      );
    });
    return { id: assignment.id, released: true };
  }

  private query(q: LicenseQueryDto) {
    const today = startOfDay();
    const where: Prisma.SoftwareLicenseWhereInput = {
      deletedAt: null,
      softwareId: q.softwareId,
      expiryDate: q.expiringDays ? { gte: today, lte: addDays(today, q.expiringDays) } : undefined,
      OR: searchFilter(q.search, ['name', 'software.name', 'vendor.name', 'notes']),
    };
    return paginate(
      q,
      async (page) =>
        (
          await this.prisma.softwareLicense.findMany({
            where,
            include: licenseInclude,
            orderBy: resolveOrderBy<Prisma.SoftwareLicenseOrderByWithRelationInput>(
              q,
              {
                expiryDate: (o) => ({ expiryDate: { sort: o, nulls: 'last' } }),
                createdAt: (o) => ({ createdAt: o }),
                seats: (o) => ({ seats: { sort: o, nulls: 'last' } }),
              },
              q.expiringDays ? { expiryDate: 'asc' } : { createdAt: 'desc' },
            ),
            ...page,
          })
        ).map((l) => this.present(l)),
      () => this.prisma.softwareLicense.count({ where }),
    );
  }

  private present<T extends LicenseRow>(license: T) {
    const { licenseKeyEncrypted, _count, ...rest } = license;
    const used = _count.assignments;
    let masked: string | null = null;
    if (licenseKeyEncrypted) {
      try {
        masked = maskSecret(this.crypto.decrypt(licenseKeyEncrypted));
      } catch {
        masked = '••••';
      }
    }
    return {
      ...rest,
      licenseKeyMasked: masked,
      usedSeats: used,
      availableSeats: license.seats === null ? null : Math.max(license.seats - used, 0),
      utilization: license.seats ? Math.round((used / license.seats) * 100) : null,
    };
  }

  private async assertRefs(dto: Partial<CreateLicenseDto>) {
    if (
      dto.softwareId &&
      !(await this.prisma.software.findFirst({ where: { id: dto.softwareId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Software not found', 'softwareId');
    }
    if (
      dto.vendorId &&
      !(await this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Vendor not found', 'vendorId');
    }
    if (
      dto.purchaseId &&
      !(await this.prisma.purchase.findFirst({ where: { id: dto.purchaseId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Purchase not found', 'purchaseId');
    }
    if (dto.startDate && dto.expiryDate && dto.expiryDate < dto.startDate) {
      throw Errors.badRequest('Expiry date must be after the start date', 'expiryDate');
    }
  }
}
