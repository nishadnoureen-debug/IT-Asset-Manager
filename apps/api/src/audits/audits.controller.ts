import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssetCondition, AuditItemResult, AuditSessionStatus, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { trim } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { PrismaService } from '../prisma/prisma.service';
import { parseScannedCode } from '../qr/qr.service';

class CreateAuditDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name!: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @Type(() => Date) @IsDate() scheduledAt?: Date;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

class UpdateAuditDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(160) name?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @Type(() => Date) @IsDate() scheduledAt?: Date;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

class ScanDto {
  @IsString() @MinLength(1) @MaxLength(512) code!: string;
  @IsOptional() @IsUUID() observedLocationId?: string;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

class ReviewItemDto {
  @IsOptional() @IsEnum(AuditItemResult) result?: AuditItemResult;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(2000) resolution!: string;
}

class AuditQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(AuditSessionStatus) status?: AuditSessionStatus;
}

class ItemQueryDto {
  @IsOptional() @IsEnum(AuditItemResult) result?: AuditItemResult;
}

const DISCREPANCIES: AuditItemResult[] = ['MISSING', 'UNEXPECTED', 'WRONG_LOCATION', 'DAMAGED'];

const sessionInclude = {
  location: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  completedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.AuditSessionInclude;

const itemInclude = {
  asset: {
    select: {
      id: true,
      assetTag: true,
      name: true,
      serialNumber: true,
      status: true,
      assetType: { select: { name: true } },
      location: { select: { id: true, name: true } },
    },
  },
  observedLocation: { select: { id: true, name: true } },
  expectedLocation: { select: { id: true, name: true } },
  scannedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.AuditItemInclude;

@ApiTags('Audits')
@Controller('audits')
export class AuditsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: AssetHistoryService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  @RequirePermissions('audit.view')
  list(@Query() q: AuditQueryDto) {
    const where: Prisma.AuditSessionWhereInput = {
      status: q.status,
      OR: searchFilter(q.search, ['name', 'notes']),
    };
    return paginate(
      q,
      async (page) => {
        const sessions = await this.prisma.auditSession.findMany({
          where,
          include: sessionInclude,
          orderBy: resolveOrderBy<Prisma.AuditSessionOrderByWithRelationInput>(
            q,
            {
              createdAt: (o) => ({ createdAt: o }),
              scheduledAt: (o) => ({ scheduledAt: { sort: o, nulls: 'last' } }),
              number: (o) => ({ number: o }),
            },
            { createdAt: 'desc' },
          ),
          ...page,
        });
        const counts = await this.summaries(sessions.map((s) => s.id));
        return sessions.map((s) => ({ ...s, summary: counts.get(s.id) ?? emptySummary() }));
      },
      () => this.prisma.auditSession.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions('audit.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const session = await this.prisma.auditSession.findUnique({
      where: { id },
      include: sessionInclude,
    });
    if (!session) throw Errors.notFound('Audit');
    const summary = (await this.summaries([id])).get(id) ?? emptySummary();
    return { ...session, summary };
  }

  @Post()
  @RequirePermissions('audit.create')
  async create(@Body() dto: CreateAuditDto, @CurrentUser() user: AuthUser) {
    await this.assertScope(dto);
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.auditSession.create({ data: { ...dto, createdById: user.id } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'audit.create',
          entityType: 'audit_session',
          entityId: created.id,
          newValues: dto,
        },
        tx,
      );
      return created;
    });
    return this.get(session.id);
  }

  @Patch(':id')
  @RequirePermissions('audit.create')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAuditDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Audit');
    const scopeChanged = dto.locationId !== undefined || dto.departmentId !== undefined;
    if (existing.status !== 'DRAFT' && scopeChanged)
      throw Errors.invalidState('Scope can only be changed before the audit starts');
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED')
      throw Errors.invalidState('Closed audits cannot be edited');
    await this.assertScope(dto);
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (changes) {
      await this.prisma.$transaction(async (tx) => {
        await tx.auditSession.update({ where: { id }, data: dto });
        await this.activity.record(
          {
            actorId: user.id,
            action: 'audit.update',
            entityType: 'audit_session',
            entityId: id,
            ...changes,
          },
          tx,
        );
      });
    }
    return this.get(id);
  }

  /** Snapshot the expected assets for the scope and open the session for scanning. */
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('audit.perform')
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const session = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!session) throw Errors.notFound('Audit');
    if (session.status !== 'DRAFT') throw Errors.invalidState('Only draft audits can be started');

    const locationIds = session.locationId
      ? await this.descendantLocations(session.locationId)
      : undefined;
    const expected = await this.prisma.asset.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['DISPOSED', 'LOST'] },
        locationId: locationIds ? { in: locationIds } : undefined,
        departmentId: session.departmentId ?? undefined,
      },
      select: { id: true, locationId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const started = await tx.auditSession.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      if (started.count !== 1)
        throw Errors.conflict('CONCURRENT_UPDATE', 'Audit was already started');
      if (expected.length) {
        await tx.auditItem.createMany({
          data: expected.map((a) => ({
            auditSessionId: id,
            assetId: a.id,
            expected: true,
            expectedLocationId: a.locationId,
          })),
          skipDuplicates: true,
        });
      }
      await this.activity.record(
        {
          actorId: user.id,
          action: 'audit.start',
          entityType: 'audit_session',
          entityId: id,
          newValues: { expectedAssets: expected.length },
        },
        tx,
      );
    });
    return this.get(id);
  }

  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('audit.perform')
  async scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScanDto,
    @CurrentUser() user: AuthUser,
  ) {
    const session = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!session) throw Errors.notFound('Audit');
    if (session.status !== 'IN_PROGRESS')
      throw Errors.invalidState('Scanning is only possible while the audit is in progress');
    if (
      dto.observedLocationId &&
      !(await this.prisma.location.findFirst({
        where: { id: dto.observedLocationId, deletedAt: null },
      }))
    ) {
      throw Errors.badRequest('Location not found', 'observedLocationId');
    }

    const { token, text } = parseScannedCode(dto.code);
    const asset = await this.prisma.asset.findFirst({
      where: {
        deletedAt: null,
        ...(token
          ? { qrToken: token }
          : {
              OR: [
                { assetTag: { equals: text, mode: 'insensitive' } },
                { serialNumber: { equals: text, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, assetTag: true, locationId: true },
    });
    const now = new Date();
    const observedLocationId = dto.observedLocationId ?? session.locationId ?? undefined;

    const item = await this.prisma.$transaction(async (tx) => {
      if (!asset) {
        return tx.auditItem.create({
          data: {
            auditSessionId: id,
            scannedCode: text.slice(0, 128),
            expected: false,
            result: 'UNEXPECTED',
            observedLocationId,
            observedCondition: dto.condition,
            scannedAt: now,
            scannedById: user.id,
            notes: dto.notes ?? 'Code does not match any registered asset',
          },
          include: itemInclude,
        });
      }
      const existing = await tx.auditItem.findUnique({
        where: { auditSessionId_assetId: { auditSessionId: id, assetId: asset.id } },
      });
      const expectedLocationId = existing?.expectedLocationId ?? null;
      let result: AuditItemResult = existing?.expected ? 'FOUND' : 'UNEXPECTED';
      if (
        result === 'FOUND' &&
        observedLocationId &&
        expectedLocationId &&
        observedLocationId !== expectedLocationId
      ) {
        result = 'WRONG_LOCATION';
      }
      if (dto.condition === 'DAMAGED') result = 'DAMAGED';

      const data = {
        result,
        scannedCode: text.slice(0, 128),
        observedLocationId,
        observedCondition: dto.condition,
        scannedAt: now,
        scannedById: user.id,
        notes: dto.notes,
      };
      const saved = existing
        ? await tx.auditItem.update({ where: { id: existing.id }, data, include: itemInclude })
        : await tx.auditItem.create({
            data: { ...data, auditSessionId: id, assetId: asset.id, expected: false },
            include: itemInclude,
          });
      await this.history.record(tx, {
        assetId: asset.id,
        action: 'AUDITED',
        performedById: user.id,
        description: `Audit AUD-${session.number}: ${result}`,
        metadata: { auditSessionId: id, result },
      });
      return saved;
    });
    return { item, recognized: !!asset, duplicate: false };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('audit.perform')
  async complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const session = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!session) throw Errors.notFound('Audit');
    if (session.status !== 'IN_PROGRESS')
      throw Errors.invalidState('Only audits in progress can be completed');
    await this.prisma.$transaction(async (tx) => {
      const missing = await tx.auditItem.updateMany({
        where: { auditSessionId: id, result: 'PENDING' },
        data: { result: 'MISSING' },
      });
      await tx.auditSession.update({
        where: { id },
        data: { status: 'IN_REVIEW', completedAt: new Date(), completedById: user.id },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'audit.complete',
          entityType: 'audit_session',
          entityId: id,
          newValues: { markedMissing: missing.count },
        },
        tx,
      );
    });
    return this.get(id);
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions('audit.review', 'audit.perform')
  async reviewItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ReviewItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    const item = await this.prisma.auditItem.findFirst({
      where: { id: itemId, auditSessionId: id },
      include: { auditSession: true },
    });
    if (!item) throw Errors.notFound('Audit item');
    if (item.auditSession.status !== 'IN_REVIEW')
      throw Errors.invalidState('Items can be reviewed once the audit is completed');
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.auditItem.update({
        where: { id: itemId },
        data: {
          result: dto.result,
          resolution: dto.resolution,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
        include: itemInclude,
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'audit.review_item',
          entityType: 'audit_item',
          entityId: itemId,
          oldValues: { result: item.result },
          newValues: dto,
        },
        tx,
      );
      return saved;
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('audit.review', 'audit.perform')
  async close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const session = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!session) throw Errors.notFound('Audit');
    if (session.status !== 'IN_REVIEW')
      throw Errors.invalidState('Complete the audit before closing it');
    await this.prisma.$transaction(async (tx) => {
      await tx.auditSession.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await this.activity.record(
        { actorId: user.id, action: 'audit.close', entityType: 'audit_session', entityId: id },
        tx,
      );
    });
    return this.get(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('audit.create')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const session = await this.prisma.auditSession.findUnique({ where: { id } });
    if (!session) throw Errors.notFound('Audit');
    if (session.status === 'CLOSED' || session.status === 'CANCELLED')
      throw Errors.invalidState('Audit is already closed');
    await this.prisma.$transaction(async (tx) => {
      await tx.auditSession.update({
        where: { id },
        data: { status: 'CANCELLED', closedAt: new Date() },
      });
      await this.activity.record(
        { actorId: user.id, action: 'audit.cancel', entityType: 'audit_session', entityId: id },
        tx,
      );
    });
    return this.get(id);
  }

  @Get(':id/items')
  @RequirePermissions('audit.view')
  async items(@Param('id', ParseUUIDPipe) id: string, @Query() q: ItemQueryDto) {
    await this.get(id);
    return this.prisma.auditItem.findMany({
      where: { auditSessionId: id, result: q.result },
      include: itemInclude,
      orderBy: [{ scannedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
  }

  @Get(':id/missing')
  @RequirePermissions('audit.view')
  async missing(@Param('id', ParseUUIDPipe) id: string) {
    await this.get(id);
    return this.prisma.auditItem.findMany({
      where: { auditSessionId: id, result: 'MISSING' },
      include: itemInclude,
    });
  }

  @Get(':id/discrepancies')
  @RequirePermissions('audit.view')
  async discrepancies(@Param('id', ParseUUIDPipe) id: string) {
    await this.get(id);
    return this.prisma.auditItem.findMany({
      where: { auditSessionId: id, result: { in: DISCREPANCIES } },
      include: itemInclude,
      orderBy: { result: 'asc' },
    });
  }

  private async summaries(ids: string[]) {
    if (!ids.length) return new Map<string, ReturnType<typeof emptySummary>>();
    const grouped = await this.prisma.auditItem.groupBy({
      by: ['auditSessionId', 'result'],
      where: { auditSessionId: { in: ids } },
      _count: { _all: true },
    });
    const map = new Map<string, ReturnType<typeof emptySummary>>();
    for (const row of grouped) {
      const summary = map.get(row.auditSessionId) ?? emptySummary();
      summary[row.result] = row._count._all;
      summary.total += row._count._all;
      map.set(row.auditSessionId, summary);
    }
    return map;
  }

  private async descendantLocations(rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM locations WHERE id = ${rootId}::uuid AND deleted_at IS NULL
        UNION ALL
        SELECT l.id FROM locations l JOIN tree t ON l.parent_id = t.id WHERE l.deleted_at IS NULL
      ) SELECT id FROM tree`;
    return rows.map((r) => r.id);
  }

  private async assertScope(dto: { locationId?: string; departmentId?: string }) {
    if (
      dto.locationId &&
      !(await this.prisma.location.findFirst({ where: { id: dto.locationId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Location not found', 'locationId');
    }
    if (
      dto.departmentId &&
      !(await this.prisma.department.findFirst({
        where: { id: dto.departmentId, deletedAt: null },
      }))
    ) {
      throw Errors.badRequest('Department not found', 'departmentId');
    }
  }
}

function emptySummary() {
  return {
    total: 0,
    PENDING: 0,
    FOUND: 0,
    MISSING: 0,
    UNEXPECTED: 0,
    WRONG_LOCATION: 0,
    DAMAGED: 0,
  };
}
