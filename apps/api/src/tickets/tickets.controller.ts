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
import { Prisma, Priority, TicketCategory, TicketStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ActivityLogService, diff } from '../activity-logs/activity-log.service';
import { assetScopeWhere } from '../assets/asset-access';
import { trim } from '../assets/assets.dto';
import { can, dataScope, NO_MATCH_ID, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginate, resolveOrderBy, searchFilter } from '../common/query/list-query';
import { documentSelect } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateTicketDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(10000) description!: string;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsUUID() assetId?: string;
  /** Staff can raise a ticket on behalf of an employee; others always raise it for themselves. */
  @IsOptional() @IsUUID() requesterId?: string;
}

class UpdateTicketDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'ON_HOLD']) status?:
    'OPEN' | 'IN_PROGRESS' | 'ON_HOLD';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assetId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Date) @IsDate() dueAt?: Date | null;
}

class CommentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) body!: string;
  @IsOptional() @IsBoolean() isInternal?: boolean;
}

class AssignTicketDto {
  @ValidateIf((_, v) => v !== null) @IsUUID() assigneeId!: string | null;
}

class ResolveTicketDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(10000) resolution!: string;
}

class TicketQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsEnum(TicketCategory) category?: TicketCategory;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @IsUUID() requesterId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  open?: boolean;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  assignedToMe?: boolean;
}

const VIEW = ['ticket.view', 'ticket.view_department', 'ticket.view_own'] as const;

const listInclude = {
  requester: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
  assignee: { select: { id: true, displayName: true } },
  asset: { select: { id: true, assetTag: true, name: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TicketInclude;

@ApiTags('Tickets')
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
    private readonly notifications: NotificationsService,
  ) {}

  private scopeWhere(user: AuthUser): Prisma.TicketWhereInput {
    const scope = dataScope(user, 'ticket');
    if (scope === 'all') return {};
    if (scope === 'department') {
      return {
        OR: [
          { requester: { departmentId: user.departmentId ?? NO_MATCH_ID } },
          { createdById: user.id },
        ],
      };
    }
    if (scope === 'own')
      return { OR: [{ requesterId: user.employeeId ?? NO_MATCH_ID }, { createdById: user.id }] };
    throw Errors.forbidden();
  }

  @Get()
  @RequirePermissions(...VIEW)
  list(@Query() q: TicketQueryDto, @CurrentUser() user: AuthUser) {
    const where: Prisma.TicketWhereInput = {
      AND: [
        this.scopeWhere(user),
        {
          status: q.open ? { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] } : q.status,
          priority: q.priority,
          category: q.category,
          assigneeId: q.assignedToMe ? user.id : q.assigneeId,
          assetId: q.assetId,
          requesterId: q.requesterId,
        },
        q.search ? { OR: searchFilter(q.search, ['title', 'description', 'asset.assetTag']) } : {},
      ],
    };
    const numeric =
      q.search && /^\d+$/.test(q.search.replace(/^tck-?/i, ''))
        ? Number(q.search.replace(/^tck-?/i, ''))
        : null;
    if (numeric !== null)
      (where.AND as Prisma.TicketWhereInput[])[2] = {
        OR: [{ number: numeric }, ...searchFilter(q.search, ['title'])!],
      };
    return paginate(
      q,
      (page) =>
        this.prisma.ticket.findMany({
          where,
          include: listInclude,
          orderBy: resolveOrderBy<Prisma.TicketOrderByWithRelationInput>(
            q,
            {
              createdAt: (o) => ({ createdAt: o }),
              updatedAt: (o) => ({ updatedAt: o }),
              priority: (o) => ({ priority: o }),
              status: (o) => ({ status: o }),
              number: (o) => ({ number: o }),
            },
            { createdAt: 'desc' },
          ),
          ...page,
        }),
      () => this.prisma.ticket.count({ where }),
    );
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const staff = can(user, 'ticket.edit');
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: {
        ...listInclude,
        createdBy: { select: { id: true, displayName: true } },
        comments: {
          where: staff ? undefined : { isInternal: false },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, displayName: true } } },
        },
        maintenance: { select: { id: true, number: true, title: true, status: true } },
        documents: { where: { deletedAt: null }, select: documentSelect },
      },
    });
    if (!ticket) throw Errors.notFound('Ticket');
    return ticket;
  }

  @Post()
  @RequirePermissions('ticket.create')
  async create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthUser) {
    const staff = can(user, 'ticket.edit');
    const requesterId = staff ? (dto.requesterId ?? user.employeeId) : user.employeeId;
    if (dto.requesterId && !staff && dto.requesterId !== user.employeeId) {
      throw Errors.forbidden('You can only raise tickets for yourself');
    }
    if (
      requesterId &&
      !(await this.prisma.employee.findFirst({ where: { id: requesterId, deletedAt: null } }))
    ) {
      throw Errors.badRequest('Requester not found', 'requesterId');
    }
    if (dto.assetId) await this.assertAssetVisible(dto.assetId, user);

    const created = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          title: dto.title,
          description: dto.description,
          category: dto.category,
          priority: dto.priority,
          assetId: dto.assetId,
          requesterId,
          createdById: user.id,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.create',
          entityType: 'ticket',
          entityId: ticket.id,
          newValues: dto,
        },
        tx,
      );
      const staffIds = await this.notifications.usersWithPermission(tx, 'ticket.assign');
      await this.notifications.notifyUsers(
        tx,
        staffIds,
        {
          type: 'TICKET_UPDATE',
          title: `New ticket TCK-${ticket.number}`,
          message: ticket.title,
          entityType: 'ticket',
          entityId: ticket.id,
          link: `/tickets/${ticket.id}`,
        },
        { excludeUserId: user.id },
      );
      return ticket;
    });
    return this.get(created.id, user);
  }

  @Patch(':id')
  @RequirePermissions('ticket.edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.loadOpen(id, user);
    if (dto.assetId) await this.assertAssetVisible(dto.assetId, user);
    const changes = diff(
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
    );
    if (!changes) return this.get(id, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: dto });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.update',
          entityType: 'ticket',
          entityId: id,
          ...changes,
        },
        tx,
      );
      if (dto.status && dto.status !== existing.status) {
        await this.notifyRequester(
          tx,
          existing,
          `Status changed to ${dto.status.replace('_', ' ').toLowerCase()}`,
          user.id,
        );
      }
    });
    return this.get(id, user);
  }

  @Post(':id/comments')
  @RequirePermissions('ticket.comment')
  async comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    const ticket = await this.get(id, user);
    if (ticket.status === 'CLOSED')
      throw Errors.invalidState('Closed tickets cannot receive comments');
    const isInternal = !!dto.isInternal && can(user, 'ticket.edit');
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.ticketComment.create({
        data: { ticketId: id, authorId: user.id, body: dto.body, isInternal },
        include: { author: { select: { id: true, displayName: true } } },
      });
      await tx.ticket.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.comment',
          entityType: 'ticket',
          entityId: id,
          newValues: { commentId: comment.id, isInternal },
        },
        tx,
      );
      const recipients = [ticket.assignee?.id].filter((x): x is string => !!x);
      if (!isInternal) {
        const requesterUser = ticket.requester
          ? await tx.user.findFirst({
              where: { employeeId: ticket.requester.id, deletedAt: null },
              select: { id: true },
            })
          : null;
        if (requesterUser) recipients.push(requesterUser.id);
      }
      await this.notifications.notifyUsers(
        tx,
        recipients,
        {
          type: 'TICKET_UPDATE',
          title: `New comment on TCK-${ticket.number}`,
          message: dto.body.slice(0, 200),
          entityType: 'ticket',
          entityId: id,
          link: `/tickets/${id}`,
        },
        { excludeUserId: user.id },
      );
      return comment;
    });
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ticket.assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.loadOpen(id, user);
    if (dto.assigneeId) {
      const assignee = await this.prisma.user.findFirst({
        where: {
          id: dto.assigneeId,
          deletedAt: null,
          status: 'ACTIVE',
          roles: {
            some: { role: { permissions: { some: { permission: { key: 'ticket.edit' } } } } },
          },
        },
      });
      if (!assignee)
        throw Errors.badRequest('Assignee must be an active IT staff member', 'assigneeId');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          assigneeId: dto.assigneeId,
          status: dto.assigneeId && existing.status === 'OPEN' ? 'IN_PROGRESS' : undefined,
        },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.assign',
          entityType: 'ticket',
          entityId: id,
          oldValues: { assigneeId: existing.assigneeId },
          newValues: { assigneeId: dto.assigneeId },
        },
        tx,
      );
      if (dto.assigneeId) {
        await this.notifications.notifyUsers(
          tx,
          [dto.assigneeId],
          {
            type: 'TICKET_UPDATE',
            title: `Ticket TCK-${existing.number} assigned to you`,
            message: existing.title,
            entityType: 'ticket',
            entityId: id,
            link: `/tickets/${id}`,
          },
          { excludeUserId: user.id },
        );
      }
    });
    return this.get(id, user);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ticket.resolve')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    const existing = await this.loadOpen(id, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { status: 'RESOLVED', resolution: dto.resolution, resolvedAt: new Date() },
      });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.resolve',
          entityType: 'ticket',
          entityId: id,
          oldValues: { status: existing.status },
          newValues: { status: 'RESOLVED', resolution: dto.resolution },
        },
        tx,
      );
      await this.notifyRequester(
        tx,
        existing,
        `Resolved: ${dto.resolution.slice(0, 160)}`,
        user.id,
      );
    });
    return this.get(id, user);
  }

  /** Staff can close any ticket; a requester can close their own ticket once it is resolved. */
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ticket.close', 'ticket.view_own', 'ticket.view_department')
  async close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    const ticket = await this.get(id, user);
    if (ticket.status === 'CLOSED') throw Errors.invalidState('Ticket is already closed');
    const isRequester = !!user.employeeId && ticket.requester?.id === user.employeeId;
    if (!can(user, 'ticket.close') && !(isRequester && ticket.status === 'RESOLVED')) {
      throw Errors.forbidden('You can close your own ticket after it has been resolved');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await this.activity.record(
        {
          actorId: user.id,
          action: 'ticket.close',
          entityType: 'ticket',
          entityId: id,
          oldValues: { status: ticket.status },
          newValues: { status: 'CLOSED' },
        },
        tx,
      );
    });
    return this.get(id, user);
  }

  private async loadOpen(id: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
    });
    if (!ticket) throw Errors.notFound('Ticket');
    if (ticket.status === 'CLOSED') throw Errors.invalidState('Closed tickets cannot be changed');
    return ticket;
  }

  private async assertAssetVisible(assetId: string, user: AuthUser) {
    const scope = assetScopeWhere(user) ?? { id: NO_MATCH_ID };
    const asset = await this.prisma.asset.findFirst({
      where: { AND: [{ id: assetId, deletedAt: null }, scope] },
    });
    if (!asset) throw Errors.badRequest('Asset not found', 'assetId');
  }

  private async notifyRequester(
    tx: Prisma.TransactionClient,
    ticket: { id: string; number: number; requesterId: string | null },
    message: string,
    actorId: string,
  ) {
    await this.notifications.notifyEmployee(
      tx,
      ticket.requesterId,
      {
        type: 'TICKET_UPDATE',
        title: `Update on TCK-${ticket.number}`,
        message,
        entityType: 'ticket',
        entityId: ticket.id,
        link: `/tickets/${ticket.id}`,
      },
      actorId,
    );
  }
}
