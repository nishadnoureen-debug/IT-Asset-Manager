import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { label } from '@itam/shared';
import { addDays, startOfDay } from '../common/query/list-query';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Daily alert generation: expiring warranties and licences, overdue returns, upcoming maintenance.
 * Every alert is de-duplicated per user and entity, so re-running is safe.
 */
@Injectable()
export class AlertsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AlertsScheduler.name);
  private startupTimer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    this.startupTimer = setTimeout(() => void this.runAll(), 15_000);
    this.startupTimer.unref();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.startupTimer);
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async scheduled(): Promise<void> {
    if (this.enabled()) await this.runAll();
  }

  async runAll(): Promise<Record<string, number>> {
    if (this.running) return {};
    this.running = true;
    try {
      const result = {
        warranty: await this.warrantyAlerts(),
        licenses: await this.licenseAlerts(),
        overdueReturns: await this.overdueReturnAlerts(),
        maintenanceDue: await this.maintenanceDueAlerts(),
      };
      this.logger.log(`Alert run complete: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error({ err: error }, 'Alert run failed');
      return {};
    } finally {
      this.running = false;
    }
  }

  private enabled(): boolean {
    return (
      this.config.get('ENABLE_SCHEDULER', { infer: true }) &&
      this.config.get('NODE_ENV', { infer: true }) !== 'test'
    );
  }

  async warrantyAlerts(): Promise<number> {
    const { warrantyAlertDays } = await this.settings.get();
    const today = startOfDay();
    const assets = await this.prisma.asset.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['RETIRED', 'DISPOSED'] },
        warrantyEndDate: { gte: today, lte: addDays(today, warrantyAlertDays) },
      },
      select: { id: true, assetTag: true, name: true, warrantyEndDate: true },
    });
    if (!assets.length) return 0;
    const recipients = await this.notifications.usersWithPermission(
      this.prisma,
      'warranty.edit',
      'maintenance.create',
    );
    let sent = 0;
    for (const asset of assets) {
      sent += await this.notifications.notifyUsers(
        this.prisma,
        recipients,
        {
          type: 'WARRANTY_EXPIRING',
          title: `Warranty expiring: ${asset.assetTag}`,
          message: `${asset.name} warranty ends on ${fmt(asset.warrantyEndDate!)}.`,
          entityType: 'asset',
          entityId: asset.id,
          link: `/assets/${asset.id}`,
        },
        { dedupeWithinHours: 24 * 7 },
      );
    }
    return sent;
  }

  async licenseAlerts(): Promise<number> {
    const { licenseAlertDays } = await this.settings.get();
    const today = startOfDay();
    const licenses = await this.prisma.softwareLicense.findMany({
      where: { deletedAt: null, expiryDate: { gte: today, lte: addDays(today, licenseAlertDays) } },
      select: {
        id: true,
        name: true,
        expiryDate: true,
        software: { select: { name: true, version: true } },
      },
    });
    if (!licenses.length) return 0;
    const recipients = await this.notifications.usersWithPermission(this.prisma, 'license.manage');
    let sent = 0;
    for (const license of licenses) {
      const name =
        license.name ?? [license.software.name, license.software.version].filter(Boolean).join(' ');
      sent += await this.notifications.notifyUsers(
        this.prisma,
        recipients,
        {
          type: 'LICENSE_EXPIRING',
          title: `License expiring: ${name}`,
          message: `${name} expires on ${fmt(license.expiryDate!)}.`,
          entityType: 'software_license',
          entityId: license.id,
          link: `/software/licenses/${license.id}`,
        },
        { dedupeWithinHours: 24 * 7 },
      );
    }
    return sent;
  }

  async overdueReturnAlerts(): Promise<number> {
    const overdue = await this.prisma.assetAssignment.findMany({
      where: { status: 'ACTIVE', expectedReturnAt: { lt: new Date() } },
      select: {
        id: true,
        expectedReturnAt: true,
        employeeId: true,
        asset: { select: { id: true, assetTag: true, name: true } },
        employee: { select: { user: { select: { id: true } } } },
      },
    });
    if (!overdue.length) return 0;
    const staff = await this.notifications.usersWithPermission(this.prisma, 'asset.return');
    let sent = 0;
    for (const a of overdue) {
      const recipients = [...staff];
      if (a.employee?.user) recipients.push(a.employee.user.id);
      sent += await this.notifications.notifyUsers(
        this.prisma,
        recipients,
        {
          type: 'OVERDUE_RETURN',
          title: `Overdue return: ${a.asset.assetTag}`,
          message: `${a.asset.name} was due back on ${fmt(a.expectedReturnAt!)}.`,
          entityType: 'asset_assignment',
          entityId: a.id,
          link: `/assets/${a.asset.id}`,
        },
        { dedupeWithinHours: 24 },
      );
    }
    return sent;
  }

  async maintenanceDueAlerts(): Promise<number> {
    const { maintenanceDueDays } = await this.settings.get();
    const due = await this.prisma.maintenance.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: addDays(new Date(), maintenanceDueDays) } },
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        scheduledAt: true,
        technicianId: true,
        asset: { select: { assetTag: true } },
      },
    });
    if (!due.length) return 0;
    const fallback = await this.notifications.usersWithPermission(this.prisma, 'maintenance.edit');
    let sent = 0;
    for (const m of due) {
      sent += await this.notifications.notifyUsers(
        this.prisma,
        m.technicianId ? [m.technicianId] : fallback,
        {
          type: 'MAINTENANCE_DUE',
          title: `Maintenance due: ${m.asset.assetTag}`,
          message: `${label('maintenanceType', m.type)} "${m.title}" is scheduled for ${fmt(m.scheduledAt!)}.`,
          entityType: 'maintenance',
          entityId: m.id,
          link: `/maintenance/${m.id}`,
        },
        { dedupeWithinHours: 24 * 3 },
      );
    }
    return sent;
  }
}
