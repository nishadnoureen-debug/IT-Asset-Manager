import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_SETTINGS, type AppSettings } from '@itam/shared';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService {
  private cached?: { value: AppSettings; expires: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async get(): Promise<AppSettings> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.value;
    const rows = await this.prisma.setting.findMany();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<AppSettings>;
    const value: AppSettings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (stored[key] !== undefined && typeof stored[key] === typeof DEFAULT_SETTINGS[key]) {
        (value as unknown as Record<string, unknown>)[key] = stored[key];
      }
    }
    this.cached = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
  }

  async update(patch: Partial<AppSettings>, actorId: string): Promise<AppSettings> {
    const before = await this.get();
    const entries = Object.entries(patch).filter(
      ([key, value]) => value !== undefined && key in DEFAULT_SETTINGS,
    );
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.setting.upsert({
          where: { key },
          create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
          update: { value: value as Prisma.InputJsonValue, updatedById: actorId },
        });
      }
      await this.activity.record(
        {
          actorId,
          action: 'settings.update',
          entityType: 'settings',
          oldValues: Object.fromEntries(entries.map(([k]) => [k, before[k as keyof AppSettings]])),
          newValues: Object.fromEntries(entries),
        },
        tx,
      );
    });
    this.cached = undefined;
    return this.get();
  }
}
