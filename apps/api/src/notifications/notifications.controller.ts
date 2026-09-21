import {
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
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { AlertsScheduler } from './alerts.scheduler';
import { NotificationsService } from './notifications.service';

class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsScheduler,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: NotificationQueryDto) {
    return this.notifications.list(user, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(id, user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  /** Run the alert checks now (they also run daily). */
  @Post('run-checks')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settings.view')
  runChecks() {
    return this.alerts.runAll();
  }
}
