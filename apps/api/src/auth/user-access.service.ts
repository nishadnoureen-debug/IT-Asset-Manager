import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth-user';

const CACHE_TTL_MS = 15_000;

/**
 * Loads a user's roles and effective permissions. Results are cached briefly; mutations to users and
 * roles call `invalidate` so changes (including disabling a user) apply within this process at once.
 */
@Injectable()
export class UserAccessService {
  private readonly cache = new Map<string, { user: AuthUser | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<AuthUser | null> {
    const hit = this.cache.get(userId);
    if (hit && hit.expires > Date.now()) return hit.user;
    const user = await this.load(userId);
    this.cache.set(userId, { user, expires: Date.now() + CACHE_TTL_MS });
    return user;
  }

  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  private async load(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'ACTIVE' },
      include: {
        employee: { select: { departmentId: true } },
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) return null;
    const permissions = new Set<string>();
    for (const { role } of user.roles) {
      for (const rp of role.permissions) permissions.add(rp.permission.key);
    }
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      employeeId: user.employeeId,
      departmentId: user.employee?.departmentId ?? null,
      roles: user.roles.map((r) => r.role.name),
      permissions,
    };
  }
}
