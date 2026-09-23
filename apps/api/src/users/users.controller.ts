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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, UserStatus } from '@prisma/client';
import { ROLES } from '@itam/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { trim } from '../assets/assets.dto';
import { can, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { PasswordService } from '../auth/password.service';
import { UserAccessService } from '../auth/user-access.service';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

class CreateUserDto {
  @Transform(lower) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) displayName!: string;
  @IsString() @MaxLength(128) password!: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsUUID('all', { each: true }) roleIds!: string[];
}

class UpdateUserDto {
  @IsOptional() @Transform(lower) @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) displayName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() employeeId?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsUUID('all', { each: true })
  roleIds?: string[];
  /** Admin-set password (e.g. after a lockout). */
  @IsOptional() @IsString() @MaxLength(128) password?: string;
}

class UserQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsUUID() roleId?: string;
}

class CreateRoleDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/, { message: 'name must be UPPER_SNAKE_CASE' })
  name!: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class UpdateRoleDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class ApproveUserDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @IsUUID('all', { each: true }) roleIds!: string[];
  @IsOptional() @IsUUID() employeeId?: string;
}

class RolePermissionsDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) permissionKeys!: string[];
}

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeNumber: true,
      department: { select: { name: true } },
    },
  },
  roles: { select: { role: { select: { id: true, name: true, displayName: true } } } },
} satisfies Prisma.UserSelect;

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly access: UserAccessService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @RequirePermissions('user.view')
  list(@Query() q: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: q.status,
      roles: q.roleId ? { some: { roleId: q.roleId } } : undefined,
      OR: searchFilter(q.search, ['email', 'displayName']),
    };
    return paginate(
      q,
      (page) =>
        this.prisma.user.findMany({
          where,
          select: userSelect,
          orderBy: resolveOrderBy<Prisma.UserOrderByWithRelationInput>(
            q,
            {
              email: (o) => ({ email: o }),
              displayName: (o) => ({ displayName: o }),
              lastLoginAt: (o) => ({ lastLoginAt: { sort: o, nulls: 'last' } }),
              createdAt: (o) => ({ createdAt: o }),
            },
            { displayName: 'asc' },
          ),
          ...page,
        }),
      () => this.prisma.user.count({ where }),
    );
  }

  /** Lightweight list of active staff for assignee pickers (maintenance, repairs). */
  @Get('staff')
  @RequirePermissions('maintenance.create', 'maintenance.edit', 'user.view')
  staff() {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              permissions: {
                some: { permission: { key: { in: ['maintenance.edit', 'request.fulfil'] } } },
              },
            },
          },
        },
      },
      select: { id: true, displayName: true, email: true },
      orderBy: { displayName: 'asc' },
    });
  }

  @Get(':id')
  @RequirePermissions('user.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...userSelect, failedLoginAttempts: true, passwordChangedAt: true },
    });
    if (!user) throw Errors.notFound('User');
    return user;
  }

  @Post()
  @RequirePermissions('user.create')
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser) {
    this.passwords.assertPolicy(dto.password);
    await this.assertRoles(dto.roleIds, actor);
    await this.assertEmployee(dto.employeeId);
    const passwordHash = await this.passwords.hash(dto.password);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          displayName: dto.displayName,
          passwordHash,
          passwordChangedAt: new Date(),
          employeeId: dto.employeeId,
          roles: { create: dto.roleIds.map((roleId) => ({ roleId, assignedById: actor.id })) },
        },
      });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          newValues: {
            email: dto.email,
            displayName: dto.displayName,
            employeeId: dto.employeeId,
            roleIds: dto.roleIds,
          },
        },
        tx,
      );
      return user;
    });
    return this.get(created.id);
  }

  @Patch(':id')
  @RequirePermissions('user.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const existing = await this.get(id);
    const existingRoleNames = existing.roles.map((r) => r.role.name);
    if (existingRoleNames.includes(ROLES.SUPER_ADMIN) && !can(actor, 'role.manage')) {
      throw Errors.forbidden('Only a Super Admin can modify a Super Admin account');
    }
    if (dto.roleIds) {
      await this.assertRoles(dto.roleIds, actor);
      if (id === actor.id && existingRoleNames.includes(ROLES.SUPER_ADMIN)) {
        const superAdmin = await this.prisma.role.findUnique({
          where: { name: ROLES.SUPER_ADMIN },
        });
        if (superAdmin && !dto.roleIds.includes(superAdmin.id))
          throw Errors.invalidState('You cannot remove your own Super Admin role');
      }
    }
    if (dto.employeeId) await this.assertEmployee(dto.employeeId, id);
    if (dto.password) this.passwords.assertPolicy(dto.password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          email: dto.email,
          displayName: dto.displayName,
          employeeId: dto.employeeId,
          ...(dto.password
            ? {
                passwordHash: await this.passwords.hash(dto.password),
                passwordChangedAt: new Date(),
                failedLoginAttempts: 0,
                lockedUntil: null,
              }
            : {}),
        },
      });
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id, roleId: { notIn: dto.roleIds } } });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId: id, roleId, assignedById: actor.id })),
          skipDuplicates: true,
        });
      }
      if (dto.password) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'user.update',
          entityType: 'user',
          entityId: id,
          oldValues: {
            email: existing.email,
            displayName: existing.displayName,
            employeeId: existing.employee?.id,
            roles: existingRoleNames,
          },
          newValues: {
            email: dto.email,
            displayName: dto.displayName,
            employeeId: dto.employeeId,
            roleIds: dto.roleIds,
            passwordReset: !!dto.password,
          },
        },
        tx,
      );
    });
    this.access.invalidate(id);
    return this.get(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.disable')
  async disable(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    if (id === actor.id) throw Errors.invalidState('You cannot disable your own account');
    const existing = await this.get(id);
    if (
      existing.roles.some((r) => r.role.name === ROLES.SUPER_ADMIN) &&
      !can(actor, 'role.manage')
    ) {
      throw Errors.forbidden('Only a Super Admin can disable a Super Admin account');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: 'DISABLED' } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'user.disable',
          entityType: 'user',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: 'DISABLED' },
        },
        tx,
      );
    });
    this.access.invalidate(id);
    return this.get(id);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.disable')
  async enable(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    const existing = await this.get(id);
    if (existing.status === 'PENDING') {
      throw Errors.invalidState('Approve this account request and choose its roles instead');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'user.enable',
          entityType: 'user',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: 'ACTIVE' },
        },
        tx,
      );
    });
    this.access.invalidate(id);
    return this.get(id);
  }

  /** Approve a self-service account request: activate it with the chosen roles. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.create')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const existing = await this.get(id);
    if (existing.status !== 'PENDING')
      throw Errors.invalidState('This account is not waiting for approval');
    await this.assertRoles(dto.roleIds, actor);
    await this.assertEmployee(dto.employeeId, id);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'ACTIVE', employeeId: dto.employeeId },
      });
      if (updated.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'This request was already handled');
      await tx.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({ userId: id, roleId, assignedById: actor.id })),
        skipDuplicates: true,
      });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'user.approve',
          entityType: 'user',
          entityId: id,
          oldValues: { status: 'PENDING' },
          newValues: { status: 'ACTIVE', roleIds: dto.roleIds, employeeId: dto.employeeId },
        },
        tx,
      );
    });
    this.access.invalidate(id);
    return this.get(id);
  }

  /** Prevent privilege escalation: only Super Admins (role.manage) may grant the Super Admin role. */
  private async assertRoles(roleIds: string[], actor: AuthUser) {
    const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } } });
    if (roles.length !== new Set(roleIds).size)
      throw Errors.badRequest('One or more roles do not exist', 'roleIds');
    if (roles.some((r) => r.name === ROLES.SUPER_ADMIN) && !can(actor, 'role.manage')) {
      throw Errors.forbidden('Only a Super Admin can grant the Super Admin role');
    }
  }

  private async assertEmployee(employeeId: string | undefined, userId?: string) {
    if (!employeeId) return;
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { user: true },
    });
    if (!employee) throw Errors.badRequest('Employee not found', 'employeeId');
    if (employee.user && employee.user.id !== userId)
      throw Errors.conflict('EMPLOYEE_ALREADY_LINKED', 'This employee already has a user account');
  }
}

@ApiTags('Roles')
@Controller()
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: UserAccessService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get('roles')
  @RequirePermissions('role.view', 'user.view')
  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { displayName: 'asc' }],
      include: { _count: { select: { users: true, permissions: true } } },
    });
    return roles;
  }

  @Get('roles/:id')
  @RequirePermissions('role.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw Errors.notFound('Role');
    const { permissions, ...rest } = role;
    return { ...rest, permissionKeys: permissions.map((p) => p.permission.key).sort() };
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  async create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthUser) {
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({ data: { ...dto, isSystem: false } });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'role.create',
          entityType: 'role',
          entityId: created.id,
          newValues: dto,
        },
        tx,
      );
      return created;
    });
    return this.get(role.id);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const existing = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: dto });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'role.update',
          entityType: 'role',
          entityId: id,
          oldValues: { displayName: existing.displayName, description: existing.description },
          newValues: dto,
        },
        tx,
      );
    });
    return this.get(id);
  }

  @Get('permissions')
  @RequirePermissions('role.view')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('role.manage')
  async setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RolePermissionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const role = await this.get(id);
    if (role.name === ROLES.SUPER_ADMIN)
      throw Errors.invalidState('Super Admin always has every permission');
    const keys = [...new Set(dto.permissionKeys)];
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    if (permissions.length !== keys.length) {
      const known = new Set(permissions.map((p) => p.key));
      throw Errors.badRequest(
        `Unknown permissions: ${keys.filter((k) => !known.has(k)).join(', ')}`,
        'permissionKeys',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({
        where: { roleId: id, permissionId: { notIn: permissions.map((p) => p.id) } },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
        skipDuplicates: true,
      });
      await this.activity.record(
        {
          actorId: actor.id,
          action: 'role.set_permissions',
          entityType: 'role',
          entityId: id,
          oldValues: { permissionKeys: role.permissionKeys },
          newValues: { permissionKeys: keys.sort() },
        },
        tx,
      );
    });
    this.access.invalidate();
    return this.get(id);
  }
}
