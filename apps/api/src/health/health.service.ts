import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HealthStatus, ReadinessStatus } from '@itam/shared';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

const DB_CHECK_TIMEOUT_MS = 3_000;

function readVersion(): string {
  try {
    // Same relative location from src/health and dist/health.
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

@Injectable()
export class HealthService {
  private readonly version = readVersion();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  liveness(): HealthStatus {
    return {
      status: 'ok',
      service: 'itam-api',
      version: this.version,
      environment: this.config.get('NODE_ENV', { infer: true }),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessStatus> {
    const database = await this.checkDatabase();
    return {
      ...this.liveness(),
      status: database.status === 'up' ? 'ok' : 'error',
      checks: { database },
    };
  }

  private async checkDatabase(): Promise<ReadinessStatus['checks'][string]> {
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Database check timed out')),
            DB_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      // Report the failure category only; connection strings must not leak.
      const name = error instanceof Error ? error.name : 'Error';
      return { status: 'down', latencyMs: Date.now() - started, error: name };
    } finally {
      clearTimeout(timer);
    }
  }
}
