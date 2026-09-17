import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, PartialType } from '@nestjs/swagger';
import { AssetCategory, LocationType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { trim } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const code = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

// ─── Departments ────────────────────────────────────────────────────────────

class CreateDepartmentDto {
  @Transform(code) @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/) code!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsUUID() managerId?: string;
}
class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {}

class SimpleQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

@ApiTags('Departments')
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  /** Reference data — readable by any signed-in user (needed for forms and filters). */
  @Get()
  list(@Query() q: SimpleQueryDto) {
    return this.prisma.department.findMany({
      where: { deletedAt: null, name: q.search ? { contains: q.search, mode: 'insensitive' } : undefined },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { employees: { where: { deletedAt: null } }, assets: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: { manager: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!department) throw Errors.notFound('Department');
    return department;
  }

  @Post()
  @RequirePermissions('department.manage')
  async create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthUser) {
    await this.assertManager(dto.managerId);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({ data: dto });
      await this.activity.record({ actorId: user.id, action: 'department.create', entityType: 'department', entityId: department.id, newValues: dto }, tx);
      return department;
    });
  }

  @Patch(':id')
  @RequirePermissions('department.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto, @CurrentUser() user: AuthUser) {
    const existing = await this.get(id);
    await this.assertManager(dto.managerId);
    const changes = diff(existing as unknown as Record<string, unknown>, dto as Record<string, unknown>);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id }, data: dto });
      if (changes) await this.activity.record({ actorId: user.id, action: 'department.update', entityType: 'department', entityId: id, ...changes }, tx);
      return department;
    });
  }

  @Delete(':id')
  @RequirePermissions('department.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.get(id);
    const [employees, assets] = await Promise.all([
      this.prisma.employee.count({ where: { departmentId: id, deletedAt: null } }),
      this.prisma.asset.count({ where: { departmentId: id, deletedAt: null } }),
    ]);
    if (employees || assets) throw Errors.invalidState(`Department still has ${employees} employees and ${assets} assets`);
    await this.prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record({ actorId: user.id, action: 'department.delete', entityType: 'department', entityId: id, oldValues: { code: existing.code, name: existing.name } }, tx);
    });
    return { id, deleted: true };
  }

  private async assertManager(managerId?: string) {
    if (managerId && !(await this.prisma.employee.findFirst({ where: { id: managerId, deletedAt: null } }))) {
      throw Errors.badRequest('Manager not found', 'managerId');
    }
  }
}

// ─── Locations ──────────────────────────────────────────────────────────────

class CreateLocationDto {
  @Transform(code) @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/) code!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsEnum(LocationType) type?: LocationType;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
class UpdateLocationDto extends PartialType(CreateLocationDto) {}

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  list(@Query() q: SimpleQueryDto) {
    return this.prisma.location.findMany({
      where: { deletedAt: null, name: q.search ? { contains: q.search, mode: 'insensitive' } : undefined },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { assets: { where: { deletedAt: null } }, employees: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const location = await this.prisma.location.findFirst({
      where: { id, deletedAt: null },
      include: { parent: { select: { id: true, name: true } }, children: { where: { deletedAt: null }, select: { id: true, name: true } } },
    });
    if (!location) throw Errors.notFound('Location');
    return location;
  }

  @Post()
  @RequirePermissions('location.manage')
  async create(@Body() dto: CreateLocationDto, @CurrentUser() user: AuthUser) {
    await this.assertParent(dto.parentId);
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.location.create({ data: dto });
      await this.activity.record({ actorId: user.id, action: 'location.create', entityType: 'location', entityId: location.id, newValues: dto }, tx);
      return location;
    });
  }

  @Patch(':id')
  @RequirePermissions('location.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto, @CurrentUser() user: AuthUser) {
    const existing = await this.get(id);
    await this.assertParent(dto.parentId, id);
    const { parent, children, ...before } = existing;
    const changes = diff(before as Record<string, unknown>, dto as Record<string, unknown>);
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.location.update({ where: { id }, data: dto });
      if (changes) await this.activity.record({ actorId: user.id, action: 'location.update', entityType: 'location', entityId: id, ...changes }, tx);
      return location;
    });
  }

  @Delete(':id')
  @RequirePermissions('location.manage')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.get(id);
    const [assets, employees] = await Promise.all([
      this.prisma.asset.count({ where: { locationId: id, deletedAt: null } }),
      this.prisma.employee.count({ where: { locationId: id, deletedAt: null } }),
    ]);
    if (assets || employees || existing.children.length) {
      throw Errors.invalidState('Location is still in use by assets, employees or child locations');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.location.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record({ actorId: user.id, action: 'location.delete', entityType: 'location', entityId: id, oldValues: { code: existing.code, name: existing.name } }, tx);
    });
    return { id, deleted: true };
  }

  /** Parent must exist and must not be the location itself or one of its descendants. */
  private async assertParent(parentId: string | undefined, selfId?: string) {
    if (!parentId) return;
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === selfId) throw Errors.badRequest('A location cannot be nested inside itself', 'parentId');
      const node: { parentId: string | null } | null = await this.prisma.location.findFirst({
        where: { id: cursor, deletedAt: null },
        select: { parentId: true },
      });
      if (!node) throw Errors.badRequest('Parent location not found', 'parentId');
      cursor = node.parentId;
    }
  }
}

// ─── Asset types ────────────────────────────────────────────────────────────

class CreateAssetTypeDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsEnum(AssetCategory) category!: AssetCategory;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsBoolean() requiresSerial?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(240) depreciationMonths?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateAssetTypeDto extends PartialType(CreateAssetTypeDto) {}

@ApiTags('Asset types')
@Controller('asset-types')
export class AssetTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  list() {
    return this.prisma.assetType.findMany({
      include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @RequirePermissions('asset_type.manage')
  create(@Body() dto: CreateAssetTypeDto, @CurrentUser() user: AuthUser) {
    return this.prisma.$transaction(async (tx) => {
      const type = await tx.assetType.create({ data: dto });
      await this.activity.record({ actorId: user.id, action: 'asset_type.create', entityType: 'asset_type', entityId: type.id, newValues: dto }, tx);
      return type;
    });
  }

  @Patch(':id')
  @RequirePermissions('asset_type.manage')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetTypeDto, @CurrentUser() user: AuthUser) {
    const existing = await this.prisma.assetType.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Asset type');
    const changes = diff(existing as unknown as Record<string, unknown>, dto as Record<string, unknown>);
    return this.prisma.$transaction(async (tx) => {
      const type = await tx.assetType.update({ where: { id }, data: dto });
      if (changes) await this.activity.record({ actorId: user.id, action: 'asset_type.update', entityType: 'asset_type', entityId: id, ...changes }, tx);
      return type;
    });
  }
}
