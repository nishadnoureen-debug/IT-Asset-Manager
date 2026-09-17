import { Injectable } from '@nestjs/common';
import { AssetHistoryAction, AssetStatus, Prisma } from '@prisma/client';
import { sanitize, type Db } from '../activity-logs/activity-log.service';

export interface HistoryEntry {
  assetId: string;
  action: AssetHistoryAction;
  fromStatus?: AssetStatus | null;
  toStatus?: AssetStatus | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  assignmentId?: string | null;
  maintenanceId?: string | null;
  performedById?: string | null;
  description?: string;
  metadata?: unknown;
}

/** Writes the append-only asset lifecycle trail. Always called inside the operation's transaction. */
@Injectable()
export class AssetHistoryService {
  record(db: Db, entry: HistoryEntry) {
    const { metadata, ...rest } = entry;
    return db.assetHistory.create({
      data: { ...rest, metadata: sanitize(metadata) as Prisma.InputJsonValue | undefined },
    });
  }
}
