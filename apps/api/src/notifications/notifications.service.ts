import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import type { PermissionKey } from '@itam/shared';
import type { Db } from '../activity-logs/activity-log.service';
import type { AuthUser } from '../auth/auth-user';
import { Errors } from '../common/errors';
import type { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notifyUsers(
    db: Db,
    userIds: Iterable<string>,
    input: NotificationInput,
    options: { dedupeWithinHours?: number; excludeUserId?: string } = {},
  ): Promise<number> {
    let recipients = [...new Set(userIds)].filter((id) => id && id !== options.excludeUserId);
    if (!recipients.length) return 0;
    if (options.dedupeWithinHours && input.entityId) {
      const since = new Date(Date.now() - options.dedupeWithinHours * 3_600_000);
      const existing = await db.notification.findMany({
        where: { userId: { in: recipients }, type: input.type, entityId: input.entityId, createdAt: { gte: since } },
        select: { userId: true },
      });
      const skip = new Set(existing.map((n) => n.userId));
      recipients = recipients.filter((id) => !skip.has(id));
    }
    if (!recipients.length) return 0;
    await db.notification.createMany({
      data: recipients.map((userId) => ({ userId, ...input })),
    });
    return recipients.length;
  }

  async notifyEmployee(db: Db, employeeId: string | null | undefined, input: NotificationInput, excludeUserId?: string) {
    if (!employeeId) return 0;
    const user = await db.user.findFirst({
      where: { employeeId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return user ? this.notifyUsers(db, [user.id], input, { excludeUserId }) : 0;
  }

  async usersWithPermission(db: Db, ...keys: PermissionKey[]): Promise<string[]> {
    const users = await db.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { key: { in: keys } } } } } } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  list(user: AuthUser, q: PaginationQueryDto & { unread?: boolean }) {
    const where: Prisma.NotificationWhereInput = { userId: user.id, readAt: q.unread ? null : undefined };
    return paginate(
      q,
      (page) => this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...page }),
      () => this.prisma.notification.count({ where }),
    );
  }

  async unreadCount(user: AuthUser) {
    return { unread: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  async markRead(id: string, user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
    if (!result.count) throw Errors.notFound('Notification');
    return this.prisma.notification.findUniqueOrThrow({ where: { id } });
  }

  async markAllRead(user: AuthUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
