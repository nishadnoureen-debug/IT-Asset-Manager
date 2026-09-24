import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AssetCondition, Prisma, Priority, RequestStatus, RequestType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { AccessoryLineDto, SIGNATURE_MAX } from '../assignments/assignments.dto';
import { AssignmentsService } from '../assignments/assignments.service';
import { trim } from '../assets/assets.dto';
import { can, dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { documentSelect, DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { requestRef, RequestPdfService } from './request-pdf.service';

class CreateRequestDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(10000) justification!: string;
  @IsOptional() @IsEnum(RequestType) type?: RequestType;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() assetTypeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity?: number;
  @IsOptional() @Type(() => Date) @IsDate() neededBy?: Date;
  /** Staff can raise a request for an employee; everyone else requests for themselves. */
  @IsOptional() @IsUUID() employeeId?: string;
}

class UpdateRequestDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(10000) justification?: string;
  @IsOptional() @IsEnum(RequestType) type?: RequestType;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assetTypeId?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity?: number;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Date)
  @IsDate()
  neededBy?: Date | null;
}

class DecisionDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
}

class RejectDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) notes!: string;
}

class FulfilDto {
  @IsOptional() @IsUUID() assetId?: string;
  /** Condition recorded on the handover form when the asset is issued. */
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AccessoryLineDto)
  accessories?: AccessoryLineDto[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(SIGNATURE_MAX) signature?: string;
}

class RequestQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(RequestStatus) status?: RequestStatus;
  @IsOptional() @IsEnum(RequestType) type?: RequestType;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() employeeId?: string;
}

const VIEW = ['request.view', 'request.view_department', 'request.view_own'] as const;
/** Statuses that can still be edited or cancelled. */
const OPEN_STATUSES: RequestStatus[] = ['SUBMITTED', 'APPROVED'];

const listInclude = {
  employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  assetType: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  decisionBy: { select: { id: true, displayName: true } },
  asset: { select: { id: true, assetTag: true, name: true } },
} satisfies Prisma.AssetRequestInclude;

/**
 * Asset requests: an employee (or IT on their behalf) asks for equipment, an approver decides, and
 * IT records the handover. Every request carries a printable form for physical signatures.
 */
@ApiTags('Asset requests')
@Controller('requests')
export class RequestsController {
  private readonly logger = new Logger(RequestsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly pdf: RequestPdfService,
    private readonly assignments: AssignmentsService,
  ) {}

  private scopeWhere(user: AuthUser): Prisma.AssetRequestWhereInput {
    const scope = dataScope(user, 'request');
    if (scope === 'all') return {};
    if (scope === 'department')
      return {
        OR: [
          { employee: { departmentId: user.departmentId ?? NO_MATCH_ID } },
          { createdById: user.id },
        ],
      };
    if (scope === 'own')
      return { OR: [{ employeeId: user.employeeId ?? NO_MATCH_ID }, { createdById: user.id }] };
    throw Errors.forbidden();
  }

  @Get()
  @RequirePermissions(...VIEW)
  list(@Query() q: RequestQueryDto, @CurrentUser() user: AuthUser) {
    const numeric = q.search?.replace(/^req-?/i, '');
    const where: Prisma.AssetRequestWhereInput = {
      AND: [
        this.scopeWhere(user),
        { status: q.status, type: q.type, priority: q.priority, employeeId: q.employeeId },
        q.search
          ? {
              OR: [
                ...(numeric && /^\d+$/.test(numeric) ? [{ number: Number(numeric) }] : []),
                ...(searchFilter(q.search, ['title', 'justification']) ?? []),
              ],
            }
          : {},
      ],
    };
    return paginate(
      q,
      (page) =>
        this.prisma.assetRequest.findMany({
          where,
          include: listInclude,
          orderBy: resolveOrderBy<Prisma.AssetRequestOrderByWithRelationInput>(
            q,
            {
              createdAt: (o) => ({ createdAt: o }),
              updatedAt: (o) => ({ updatedAt: o }),
              priority: (o) => ({ priority: o }),
              status: (o) => ({ status: o }),
              number: (o) => ({ number: o }),
              neededBy: (o) => ({ neededBy: { sort: o, nulls: 'last' } }),
            },
            { createdAt: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.assetRequest.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const found = await this.prisma.assetRequest.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: {
        ...listInclude,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            jobTitle: true,
            department: { select: { id: true, name: true } },
          },
        },
        fulfilledBy: { select: { id: true, displayName: true } },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
    if (!found) throw Errors.notFound('Request');
    return found;
  }

  @Post()
  @RequirePermissions('request.create')
  async create(@Body() dto: CreateRequestDto, @CurrentUser() user: AuthUser) {
    const staff = can(user, 'request.edit');
    const employeeId = staff ? (dto.employeeId ?? user.employeeId) : user.employeeId;
    if (dto.employeeId && !staff && dto.employeeId !== user.employeeId)
      throw Errors.forbidden('You can only raise requests for yourself');
    if (
      employeeId &&
      !(await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } }))
    )
      throw Errors.badRequest('Employee not found', 'employeeId');
    if (dto.assetTypeId) await this.assertAssetType(dto.assetTypeId);

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.assetRequest.create({
        data: {
          title: dto.title,
          justification: dto.justification,
          type: dto.type,
          priority: dto.priority,
          assetTypeId: dto.assetTypeId,
          quantity: dto.quantity,
          neededBy: dto.neededBy,
          employeeId,
          createdById: user.id,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'request.create',
          entityType: 'request',
          entityId: request.id,
          newValues: dto,
        },
        tx,
      );
      const approvers = await this.notifications.usersWithPermission(tx, 'request.approve');
      await this.notifications.notifyUsers(
        tx,
        approvers,
        {
          type: 'REQUEST_UPDATE',
          title: `New asset request ${requestRef(request.number)}`,
          message: `${request.title} — waiting for approval`,
          entityType: 'request',
          entityId: request.id,
          link: `/requests/${request.id}`,
        },
        { excludeUserId: user.id },
      );
      return request;
    });
    await this.attachForm(created.id, user.id);
    return this.get(created.id, user);
  }

  @Patch(':id')
  @RequirePermissions('request.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.get(id, user);
    if (existing.status !== 'SUBMITTED')
      throw Errors.invalidState('Only requests waiting for approval can be changed');
    if (dto.assetTypeId) await this.assertAssetType(dto.assetTypeId);
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (!changes) return existing;
    await this.prisma.$transaction(async (tx) => {
      await tx.assetRequest.update({ where: { id }, data: dto });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'request.update',
          entityType: 'request',
          entityId: id,
          ...changes,
        },
        tx,
      );
    });
    await this.attachForm(id, user.id);
    return this.get(id, user);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('request.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.decide(id, 'APPROVED', dto.notes ?? null, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('request.approve')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.decide(id, 'REJECTED', dto.notes, user);
  }

  /**
   * Hands the approved asset over: assigns it to the employee (stock, status, handover form and
   * acknowledgement all follow the normal assign flow) and closes the request.
   */
  @Post(':id/fulfil')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('request.fulfil')
  async fulfil(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FulfilDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.get(id, user);
    if (existing.status !== 'APPROVED')
      throw Errors.invalidState('Only an approved request can be fulfilled');
    if (
      dto.assetId &&
      !(await this.prisma.asset.findFirst({ where: { id: dto.assetId, deletedAt: null } }))
    )
      throw Errors.badRequest('Asset not found', 'assetId');
    if (dto.accessories?.length && !dto.assetId)
      throw Errors.badRequest('Choose the asset being handed over', 'assetId');

    // Assigning needs asset.assign; without it the request is only recorded as fulfilled.
    if (dto.assetId && existing.employeeId && can(user, 'asset.assign')) {
      await this.assignments.assign(
        dto.assetId,
        {
          employeeId: existing.employeeId,
          condition: dto.condition ?? 'GOOD',
          accessories: dto.accessories,
          notes: dto.notes,
          signature: dto.signature,
        },
        user,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetRequest.updateMany({
        where: { id, status: 'APPROVED' },
        data: {
          status: 'FULFILLED',
          assetId: dto.assetId,
          fulfilledById: user.id,
          fulfilledAt: new Date(),
          decisionNotes: dto.notes ?? existing.decisionNotes,
        },
      });
      if (updated.count === 0)
        throw Errors.conflict('CONCURRENT_UPDATE', 'This request was already handled');
      await this.activity.record(
        {
          actorId: user.id,
          action: 'request.fulfil',
          entityType: 'request',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: 'FULFILLED', assetId: dto.assetId },
        },
        tx,
      );
      await this.notifyRequester(tx, existing, 'Your asset request has been fulfilled', user.id);
    });
    await this.attachForm(id, user.id);
    return this.get(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('request.cancel', 'request.create')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.get(id, user);
    // Requesters may withdraw their own request; otherwise the cancel permission is required.
    const own = existing.createdById === user.id || existing.employeeId === user.employeeId;
    if (!own && !can(user, 'request.cancel'))
      throw Errors.forbidden('You can only cancel your own requests');
    if (!OPEN_STATUSES.includes(existing.status))
      throw Errors.invalidState(`A ${existing.status.toLowerCase()} request cannot be cancelled`);

    await this.prisma.$transaction(async (tx) => {
      await tx.assetRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          decisionNotes: dto.notes ?? undefined,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'request.cancel',
          entityType: 'request',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: 'CANCELLED', notes: dto.notes },
        },
        tx,
      );
    });
    return this.get(id, user);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async decide(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    notes: string | null,
    user: AuthUser,
  ) {
    const existing = await this.get(id, user);
    if (existing.status !== 'SUBMITTED')
      throw Errors.invalidState('This request has already been decided');

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetRequest.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: { status, decisionById: user.id, decisionAt: new Date(), decisionNotes: notes },
      });
      if (updated.count === 0)
        throw Errors.conflict('CONCURRENT_UPDATE', 'This request was already decided');
      await this.activity.record(
        {
          actorId: user.id,
          action: status === 'APPROVED' ? 'request.approve' : 'request.reject',
          entityType: 'request',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status, notes },
        },
        tx,
      );
      await this.notifyRequester(
        tx,
        existing,
        status === 'APPROVED'
          ? 'Your asset request was approved'
          : `Your asset request was rejected: ${notes ?? ''}`.trim(),
        user.id,
      );
    });
    await this.attachForm(id, user.id);
    return this.get(id, user);
  }

  /** (Re)generates the printable form so the stored PDF always shows the current state. */
  private async attachForm(id: string, actorId: string): Promise<void> {
    try {
      const request = await this.prisma.assetRequest.findUniqueOrThrow({
        where: { id },
        select: { number: true, status: true },
      });
      const ref = requestRef(request.number);
      const pdf = await this.pdf.render(id);
      await this.prisma.$transaction(async (tx) => {
        // Replace the previous version so the record keeps one current form.
        await tx.document.updateMany({
          where: { assetRequestId: id, type: 'REQUEST_FORM', deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await this.documents.store(
          tx,
          {
            buffer: pdf,
            mimeType: 'application/pdf',
            type: 'REQUEST_FORM',
            title: `Asset request form — ${ref}`,
            originalFileName: `asset-request-${ref}.pdf`,
            owner: { assetRequestId: id },
          },
          actorId,
        );
      });
    } catch (error) {
      this.logger.error({ err: error, requestId: id }, 'Failed to generate the asset request form');
    }
  }

  private async assertAssetType(assetTypeId: string): Promise<void> {
    if (!(await this.prisma.assetType.findFirst({ where: { id: assetTypeId, isActive: true } })))
      throw Errors.badRequest('Asset type not found', 'assetTypeId');
  }

  private async notifyRequester(
    tx: Prisma.TransactionClient,
    request: { id: string; number: number; createdById: string | null; employeeId: string | null },
    message: string,
    actorId: string,
  ): Promise<void> {
    const userIds = new Set<string>();
    if (request.createdById) userIds.add(request.createdById);
    if (request.employeeId) {
      const employeeUser = await tx.user.findFirst({
        where: { employeeId: request.employeeId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (employeeUser) userIds.add(employeeUser.id);
    }
    await this.notifications.notifyUsers(
      tx,
      [...userIds],
      {
        type: 'REQUEST_UPDATE',
        title: `Asset request ${requestRef(request.number)}`,
        message,
        entityType: 'request',
        entityId: request.id,
        link: `/requests/${request.id}`,
      },
      { excludeUserId: actorId },
    );
  }
}
