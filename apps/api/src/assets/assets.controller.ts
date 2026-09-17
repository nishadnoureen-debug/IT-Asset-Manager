import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import {
  AssetQueryDto,
  CreateAssetDto,
  DisposeAssetDto,
  ReportLostDto,
  RetireAssetDto,
  UpdateAssetDto,
} from './assets.dto';
import { AssetsService } from './assets.service';

const VIEW = ['asset.view', 'asset.view_department', 'asset.view_own'] as const;
type Id = string;

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermissions(...VIEW)
  list(@Query() q: AssetQueryDto, @CurrentUser() user: AuthUser) {
    return this.assets.list(q, user);
  }

  @Post()
  @RequirePermissions('asset.create')
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.get(id, user);
  }

  @Patch(':id')
  @RequirePermissions('asset.edit')
  update(@Param('id', ParseUUIDPipe) id: Id, @Body() dto: UpdateAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('asset.delete')
  remove(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.remove(id, user);
  }

  @Get(':id/history')
  @RequirePermissions(...VIEW)
  history(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.historyFor(id, user);
  }

  @Get(':id/assignments')
  @RequirePermissions(...VIEW)
  assignments(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.assignments(id, user);
  }

  @Get(':id/maintenance')
  @RequirePermissions(...VIEW)
  maintenance(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.maintenance(id, user);
  }

  @Get(':id/documents')
  @RequirePermissions(...VIEW)
  documents(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.documents(id, user);
  }

  @Get(':id/software')
  @RequirePermissions(...VIEW)
  software(@Param('id', ParseUUIDPipe) id: Id, @CurrentUser() user: AuthUser) {
    return this.assets.software(id, user);
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.retire')
  retire(@Param('id', ParseUUIDPipe) id: Id, @Body() dto: RetireAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.retire(id, dto, user);
  }

  @Post(':id/dispose')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.dispose')
  dispose(@Param('id', ParseUUIDPipe) id: Id, @Body() dto: DisposeAssetDto, @CurrentUser() user: AuthUser) {
    return this.assets.dispose(id, dto, user);
  }

  @Post(':id/report-lost')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('asset.report_lost')
  reportLost(@Param('id', ParseUUIDPipe) id: Id, @Body() dto: ReportLostDto, @CurrentUser() user: AuthUser) {
    return this.assets.reportLost(id, dto, user);
  }
}
