import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto, EmployeeQueryDto, UpdateEmployeeDto } from './employees.dto';

const listInclude = {
  department: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  user: { select: { id: true, status: true } },
  _count: { select: { assignments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  scopeWhere(user: AuthUser): Prisma.EmployeeWhereInput {
    const scope = dataScope(user, 'employee');
    if (scope === 'all') return {};
    if (scope === 'department') return { departmentId: user.departmentId ?? NO_MATCH_ID };
    if (scope === 'own') return { id: user.employeeId ?? NO_MATCH_ID };
    throw Errors.forbidden();
  }

  list(q: EmployeeQueryDto, user: AuthUser) {
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        this.scopeWhere(user),
        {
          deletedAt: null,
          departmentId: q.departmentId,
          locationId: q.locationId,
          status: q.status,
        },
        q.search
          ? {
              OR: searchFilter(q.search, [
                'firstName',
                'lastName',
                'email',
                'employeeNumber',
                'jobTitle',
              ]),
            }
          : {},
      ],
    };
    const orderBy = resolveOrderBy<
      Prisma.EmployeeOrderByWithRelationInput | Prisma.EmployeeOrderByWithRelationInput[]
    >(
      q,
      {
        name: (o) => [{ lastName: o }, { firstName: o }],
        employeeNumber: (o) => ({ employeeNumber: o }),
        email: (o) => ({ email: o }),
        createdAt: (o) => ({ createdAt: o }),
      },
      [{ lastName: 'asc' }, { firstName: 'asc' }],
    );
    return paginate(
      q,
      (page) => this.prisma.employee.findMany({ where, include: listInclude, orderBy, ...page }),
      () => this.prisma.employee.count({ where }),
    );
  }

  async get(id: string, user: AuthUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scopeWhere(user)] },
      include: {
        ...listInclude,
        manager: { select: { id: true, firstName: true, lastName: true } },
        user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
        _count: {
          select: {
            assignments: { where: { status: 'ACTIVE' } },
            requests: true,
            accessoryAssignments: { where: { status: 'ACTIVE' } },
          },
        },
      },
    });
    if (!employee) throw Errors.notFound('Employee');
    return employee;
  }

  async create(dto: CreateEmployeeDto, user: AuthUser) {
    await this.assertReferences(dto);
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({ data: dto });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'employee.create',
          entityType: 'employee',
          entityId: employee.id,
          newValues: dto,
        },
        tx,
      );
      return employee;
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, user: AuthUser) {
    const existing = await this.get(id, user);
    await this.assertReferences(dto, id);
    if (dto.status === 'TERMINATED' && existing.status !== 'TERMINATED') {
      if (existing._count.assignments > 0 || existing._count.accessoryAssignments > 0) {
        throw Errors.invalidState(
          'Return all assets and accessories before terminating this employee',
        );
      }
      dto.terminationDate ??= new Date();
    }
    const { department, location, user: _u, manager, _count, ...before } = existing;
    const changes = diff(before as Record<string, unknown>, dto as Record<string, unknown>);
    if (!changes) return existing;
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: dto });
      if (dto.status === 'TERMINATED' && existing.user) {
        await tx.user.update({ where: { id: existing.user.id }, data: { status: 'DISABLED' } });
        await tx.refreshToken.updateMany({
          where: { userId: existing.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'employee.update',
          entityType: 'employee',
          entityId: id,
          ...changes,
        },
        tx,
      );
    });
    return this.get(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.get(id, user);
    if (existing._count.assignments > 0 || existing._count.accessoryAssignments > 0) {
      throw Errors.invalidState('This employee still holds assets or accessories');
    }
    if (existing.user && existing.user.status === 'ACTIVE') {
      throw Errors.invalidState('Disable the linked user account first');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'employee.delete',
          entityType: 'employee',
          entityId: id,
          oldValues: { employeeNumber: existing.employeeNumber, email: existing.email },
        },
        tx,
      );
    });
    return { id, deleted: true };
  }

  async assets(id: string, user: AuthUser) {
    await this.get(id, user);
    const [active, history, accessories] = await Promise.all([
      this.prisma.assetAssignment.findMany({
        where: { employeeId: id, status: 'ACTIVE' },
        orderBy: { assignedAt: 'desc' },
        include: {
          asset: {
            select: {
              id: true,
              assetTag: true,
              name: true,
              serialNumber: true,
              status: true,
              condition: true,
              assetType: { select: { name: true, category: true } },
            },
          },
        },
      }),
      this.prisma.assetAssignment.findMany({
        where: { employeeId: id, status: { not: 'ACTIVE' } },
        orderBy: { assignedAt: 'desc' },
        take: 100,
        include: { asset: { select: { id: true, assetTag: true, name: true } } },
      }),
      this.prisma.accessoryAssignment.findMany({
        where: { employeeId: id, status: 'ACTIVE' },
        include: { accessory: { select: { id: true, name: true, category: true } } },
      }),
    ]);
    return { active, history, accessories };
  }

  async requests(id: string, user: AuthUser) {
    await this.get(id, user);
    return this.prisma.assetRequest.findMany({
      where: { employeeId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        type: true,
        neededBy: true,
        createdAt: true,
      },
    });
  }

  private async assertReferences(dto: Partial<CreateEmployeeDto>, selfId?: string) {
    if (
      dto.departmentId &&
      !(await this.prisma.department.findFirst({
        where: { id: dto.departmentId, deletedAt: null },
      }))
    ) {
      throw Errors.badRequest('Department not found', 'departmentId');
    }
    if (
      dto.locationId &&
      !(await this.prisma.location.findFirst({ where: { id: dto.locationId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Location not found', 'locationId');
    }
    if (dto.managerId) {
      if (dto.managerId === selfId)
        throw Errors.badRequest('An employee cannot manage themselves', 'managerId');
      if (
        !(await this.prisma.employee.findFirst({ where: { id: dto.managerId, deletedAt: null } }))
      ) {
        throw Errors.badRequest('Manager not found', 'managerId');
      }
    }
  }
}
