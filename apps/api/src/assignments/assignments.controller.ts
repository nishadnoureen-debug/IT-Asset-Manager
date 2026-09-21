import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import {
  AcknowledgeDto,
  AssignAssetDto,
  AssignmentQueryDto,
  ReturnAssetDto,
  TransferAssetDto,
} from './assignments.dto';
import { AssignmentsService } from './assignments.service';

const VIEW = ['asset.view', 'asset.view_department', 'asset.view_own'] as const;

@ApiTags('Assignments')
@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  @RequirePermissions(...VIEW)
  list(@Query() q: AssignmentQueryDto, @CurrentUser() user: AuthUser) {
    return this.assignments.list(q, user);
  }

  @Get('assignments/:id')
  @RequirePermissions(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.assignments.get(id, user);
  }

  @Post('assignments/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.acknowledge')
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.acknowledge(id, dto, user);
  }

  @Post('assets/:id/assign')
  @RequirePermissions('asset.assign')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.assign(id, dto, user);
  }

  @Post('assets/:id/return')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.return')
  returnAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.returnAsset(id, dto, user);
  }

  @Post('assets/:id/transfer')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.transfer')
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferAssetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assignments.transfer(id, dto, user);
  }
}
