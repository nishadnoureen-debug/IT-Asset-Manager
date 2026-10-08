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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { AssetQueryDto } from '../assets/assets.dto';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator';
import { MAX_LABELS, QrService } from './qr.service';

class ScanDto {
  @IsString() @MinLength(1) @MaxLength(512) code!: string;
}

class DownloadQueryDto {
  @IsOptional() @IsIn(['png', 'svg']) format: 'png' | 'svg' = 'png';
}

/** Assets to print: the ones ticked, or — with no ids — everything the list's filters match. */
class LabelsQueryDto extends AssetQueryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(MAX_LABELS)
  @IsUUID('all', { each: true })
  assetIds?: string[];
}

const VIEW = ['asset.view', 'asset.view_department', 'asset.view_own'] as const;

@ApiTags('QR')
@Controller()
export class QrController {
  constructor(private readonly qr: QrService) {}

  @Get('assets/:id/qr')
  @RequirePermissions(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.qr.get(id, user);
  }

  @Post('assets/:id/qr/regenerate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('qr.generate')
  regenerate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.qr.regenerate(id, user);
  }

  @Get('assets/:id/qr/download')
  @SkipEnvelope()
  @RequirePermissions('qr.generate')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DownloadQueryDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.qr.download(id, q.format, user);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
    });
    return new StreamableFile(file.body);
  }

  @Post('qr/scan')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('qr.scan', ...VIEW)
  scan(@Body() dto: ScanDto, @CurrentUser() user: AuthUser) {
    return this.qr.scan(dto.code, user);
  }

  @Get('qr/labels')
  @SkipEnvelope()
  @RequirePermissions('qr.generate')
  async labels(
    @Query() q: LabelsQueryDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdf = await this.qr.labels(q, user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="asset-labels.pdf"',
    });
    return new StreamableFile(pdf);
  }
}
