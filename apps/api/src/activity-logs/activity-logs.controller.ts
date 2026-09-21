import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';

class ActivityLogQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

const include = { actor: { select: { id: true, email: true, displayName: true } } } as const;

@ApiTags('Activity logs')
@Controller('activity-logs')
@RequirePermissions('activity_log.view')
export class ActivityLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() q: ActivityLogQueryDto) {
    const where: Prisma.ActivityLogWhereInput = {
      actorId: q.actorId,
      entityType: q.entityType,
      entityId: q.entityId,
      action: q.action ? { startsWith: q.action } : undefined,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
      OR: q.search
        ? [
            { action: { contains: q.search, mode: 'insensitive' } },
            { entityType: { contains: q.search, mode: 'insensitive' } },
            { actor: { email: { contains: q.search, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    return paginate(
      q,
      (page) =>
        this.prisma.activityLog.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          ...page,
        }),
      () => this.prisma.activityLog.count({ where }),
    );
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const log = await this.prisma.activityLog.findUnique({ where: { id }, include });
    if (!log) throw Errors.notFound('Activity log');
    return log;
  }
}
