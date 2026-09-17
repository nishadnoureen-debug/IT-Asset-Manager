import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { HealthStatus, ReadinessStatus } from '@itam/shared';
import { Public } from '../auth/decorators';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness — the process is up' })
  liveness(): HealthStatus {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness — dependencies (database) are reachable; 503 otherwise' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessStatus> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
