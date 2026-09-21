import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';

export type Db = PrismaService | Prisma.TransactionClient;

export interface ActivityEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

const SENSITIVE_KEYS = /password|token|secret|licenseKey|hash/i;

/** Strip secrets and non-JSON values before persisting. */
export function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key && SENSITIVE_KEYS.test(key)) return '[REDACTED]';
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  ) as Prisma.InputJsonValue;
}

/** Only the fields that changed, as `{ old, new }` snapshots. */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { oldValues: Partial<T>; newValues: Partial<T> } | null {
  const oldValues: Partial<T> = {};
  const newValues: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (after[key] === undefined) continue;
    if (normalise(before[key]) !== normalise(after[key])) {
      oldValues[key] = before[key];
      newValues[key] = after[key] as T[keyof T];
    }
  }
  return Object.keys(newValues).length ? { oldValues, newValues } : null;
}

function normalise(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (
    value !== null &&
    typeof value === 'object' &&
    'toString' in value &&
    value.constructor?.name === 'Decimal'
  ) {
    return String(Number(value));
  }
  return JSON.stringify(value ?? null);
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an activity log row. Pass the transaction client for lifecycle operations so the log commits
   * (or rolls back) with the change it describes.
   */
  async record(entry: ActivityEntry, db: Db = this.prisma): Promise<void> {
    const ctx = RequestContext.get();
    await db.activityLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValues: sanitize(entry.oldValues),
        newValues: sanitize(entry.newValues),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      },
    });
  }

  /** For non-transactional events (e.g. failed logins) where logging must never break the request. */
  async recordSafely(entry: ActivityEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'Failed to write activity log');
    }
  }
}
