import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient for the process. The connection is opened lazily on the first query so the
 * API can boot (and report readiness as "down") while the database is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
