import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { assetScopeWhere } from '../assets/asset-access';
import { can, dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { addDays, startOfDay, startOfMonth } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@ApiTags('Dashboard')
@Controller('dashboard')
@RequirePermissions('dashboard.view')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    const [assets, warrantyAlerts, licenseAlerts, recentActivity, operations, mine] = await Promise.all([
      this.assetsSummary(user),
      this.warrantyAlerts(user),
      this.licenseAlerts(user),
      this.recentActivity(user),
      this.operations(user),
      this.personal(user),
    ]);
    return { scope: dataScope(user, 'asset'), assets, warrantyAlerts, licenseAlerts, recentActivity, ...operations, mine };
  }

  @Get('assets-summary')
  assetsSummary(@CurrentUser() user: AuthUser) {
    return this.buildAssetsSummary(user);
  }

  @Get('warranty-alerts')
  async warrantyAlerts(@CurrentUser() user: AuthUser) {
    const scope = assetScopeWhere(user);
    if (!scope || (!can(user, 'warranty.view') && dataScope(user, 'asset') === 'own')) return { expiringCount: 0, expiredCount: 0, items: [] };
    const { warrantyAlertDays } = await this.settings.get();
    const today = startOfDay();
    const base: Prisma.AssetWhereInput = { AND: [scope, { deletedAt: null, status: { notIn: ['RETIRED', 'DISPOSED'] } }] };
    const expiringWhere: Prisma.AssetWhereInput = { AND: [base, { warrantyEndDate: { gte: today, lte: addDays(today, warrantyAlertDays) } }] };
    const [items, expiringCount, expiredCount] = await Promise.all([
      this.prisma.asset.findMany({
        where: expiringWhere,
        select: { id: true, assetTag: true, name: true, warrantyEndDate: true, warrantyProvider: { select: { name: true } } },
        orderBy: { warrantyEndDate: 'asc' },
        take: 8,
      }),
      this.prisma.asset.count({ where: expiringWhere }),
      this.prisma.asset.count({ where: { AND: [base, { warrantyEndDate: { lt: today } }] } }),
    ]);
    return { alertDays: warrantyAlertDays, expiringCount, expiredCount, items };
  }

  @Get('license-alerts')
  async licenseAlerts(@CurrentUser() user: AuthUser) {
    if (!can(user, 'license.view', 'license.manage')) return { expiringCount: 0, items: [] };
    const { licenseAlertDays } = await this.settings.get();
    const today = startOfDay();
    const where: Prisma.SoftwareLicenseWhereInput = { deletedAt: null, expiryDate: { gte: today, lte: addDays(today, licenseAlertDays) } };
    const [items, expiringCount, licenses] = await Promise.all([
      this.prisma.softwareLicense.findMany({
        where,
        select: { id: true, name: true, expiryDate: true, seats: true, software: { select: { name: true, version: true } } },
        orderBy: { expiryDate: 'asc' },
        take: 8,
      }),
      this.prisma.softwareLicense.count({ where }),
      this.prisma.softwareLicense.findMany({
        where: { deletedAt: null, seats: { not: null } },
        select: { seats: true, _count: { select: { assignments: { where: { unassignedAt: null } } } } },
      }),
    ]);
    const totalSeats = licenses.reduce((s, l) => s + (l.seats ?? 0), 0);
    const usedSeats = licenses.reduce((s, l) => s + l._count.assignments, 0);
    return { alertDays: licenseAlertDays, expiringCount, items, totalSeats, usedSeats };
  }

  @Get('recent-activity')
  async recentActivity(@CurrentUser() user: AuthUser) {
    const scope = assetScopeWhere(user);
    if (!scope) return [];
    return this.prisma.assetHistory.findMany({
      where: { asset: { AND: [scope, { deletedAt: null }] } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        action: true,
        fromStatus: true,
        toStatus: true,
        description: true,
        createdAt: true,
        asset: { select: { id: true, assetTag: true, name: true } },
        performedBy: { select: { id: true, displayName: true } },
      },
    });
  }

  private async buildAssetsSummary(user: AuthUser) {
    const scope = assetScopeWhere(user);
    if (!scope) return { total: 0, byStatus: {}, byCategory: [] };
    const where: Prisma.AssetWhereInput = { AND: [scope, { deletedAt: null }] };
    const [total, byStatus, byType] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['assetTypeId'], where, _count: { _all: true } }),
    ]);
    const types = await this.prisma.assetType.findMany({ where: { id: { in: byType.map((t) => t.assetTypeId) } } });
    const categoryCounts = new Map<string, number>();
    for (const row of byType) {
      const category = types.find((t) => t.id === row.assetTypeId)?.category ?? 'ACCESSORY';
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + row._count._all);
    }
    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      byCategory: [...categoryCounts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    };
  }

  private async operations(user: AuthUser) {
    const monthStart = startOfMonth();
    const assetScope = assetScopeWhere(user);
    const staff = dataScope(user, 'asset') === 'all';

    const assignments = assetScope
      ? await (async () => {
          const scoped: Prisma.AssetAssignmentWhereInput = { asset: { AND: [assetScope, { deletedAt: null }] } };
          const [active, assignedThisMonth, returnedThisMonth, overdue, unacknowledged] = await Promise.all([
            this.prisma.assetAssignment.count({ where: { ...scoped, status: 'ACTIVE' } }),
            this.prisma.assetAssignment.count({ where: { ...scoped, assignedAt: { gte: monthStart } } }),
            this.prisma.assetAssignment.count({ where: { ...scoped, status: 'RETURNED', returnedAt: { gte: monthStart } } }),
            this.prisma.assetAssignment.count({ where: { ...scoped, status: 'ACTIVE', expectedReturnAt: { lt: new Date() } } }),
            this.prisma.assetAssignment.count({ where: { ...scoped, status: 'ACTIVE', acknowledgedAt: null, employeeId: { not: null } } }),
          ]);
          return { active, assignedThisMonth, returnedThisMonth, overdue, unacknowledged };
        })()
      : null;

    const maintenance = can(user, 'maintenance.view')
      ? await (async () => {
          const [scheduled, inProgress, completedThisMonth, cost] = await Promise.all([
            this.prisma.maintenance.count({ where: { status: 'SCHEDULED' } }),
            this.prisma.maintenance.count({ where: { status: 'IN_PROGRESS' } }),
            this.prisma.maintenance.count({ where: { status: 'COMPLETED', completedAt: { gte: monthStart } } }),
            this.prisma.maintenance.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: monthStart } }, _sum: { totalCost: true } }),
          ]);
          return { scheduled, inProgress, completedThisMonth, costThisMonth: Number(cost._sum.totalCost ?? 0) };
        })()
      : null;

    const ticketScope = dataScope(user, 'ticket');
    const tickets = ticketScope
      ? await (async () => {
          const where: Prisma.TicketWhereInput =
            ticketScope === 'all'
              ? {}
              : ticketScope === 'department'
                ? { requester: { departmentId: user.departmentId ?? NO_MATCH_ID } }
                : { OR: [{ requesterId: user.employeeId ?? NO_MATCH_ID }, { createdById: user.id }] };
          const [open, inProgress, highPriority, assignedToMe] = await Promise.all([
            this.prisma.ticket.count({ where: { ...where, status: 'OPEN' } }),
            this.prisma.ticket.count({ where: { ...where, status: { in: ['IN_PROGRESS', 'ON_HOLD'] } } }),
            this.prisma.ticket.count({ where: { ...where, status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] }, priority: { in: ['HIGH', 'CRITICAL'] } } }),
            staff ? this.prisma.ticket.count({ where: { assigneeId: user.id, status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] } } }) : Promise.resolve(0),
          ]);
          return { open, inProgress, highPriority, assignedToMe };
        })()
      : null;

    const audits = can(user, 'audit.view')
      ? { inProgress: await this.prisma.auditSession.count({ where: { status: { in: ['IN_PROGRESS', 'IN_REVIEW'] } } }) }
      : null;

    return { assignments, maintenance, tickets, audits };
  }

  /** "My assets" for every user linked to an employee record. */
  private async personal(user: AuthUser) {
    if (!user.employeeId) return null;
    const [assets, accessories, openTickets] = await Promise.all([
      this.prisma.assetAssignment.findMany({
        where: { employeeId: user.employeeId, status: 'ACTIVE' },
        orderBy: { assignedAt: 'desc' },
        select: {
          id: true,
          assignedAt: true,
          acknowledgedAt: true,
          expectedReturnAt: true,
          asset: { select: { id: true, assetTag: true, name: true, status: true, assetType: { select: { name: true, category: true } } } },
        },
      }),
      this.prisma.accessoryAssignment.findMany({
        where: { employeeId: user.employeeId, status: 'ACTIVE' },
        select: { id: true, quantity: true, accessory: { select: { id: true, name: true } } },
      }),
      this.prisma.ticket.count({ where: { requesterId: user.employeeId, status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED'] } } }),
    ]);
    return { assets, accessories, openTickets };
  }
}
