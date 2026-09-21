import { Controller, Get, Param, ParseEnumPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { can, type AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator';
import { Errors } from '../common/errors';
import { PdfService } from '../pdf/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { toCsv, toPdf, toXlsx } from './report-renderers';
import { REPORT_TYPES, ReportsService, type ReportType } from './reports.service';

class ReportQueryDto {
  @IsOptional() @IsIn(['json', 'csv', 'xlsx', 'pdf']) format: 'json' | 'csv' | 'xlsx' | 'pdf' =
    'json';
  @IsOptional() @IsString() @MaxLength(200) status?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() assetTypeId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() auditId?: string;
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) days?: number;
  /** Row cap for on-screen previews. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

@ApiTags('Reports')
@Controller('reports')
@RequirePermissions('report.view', 'report.export')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Get()
  catalogue(@CurrentUser() user: AuthUser) {
    return this.reports.catalogue(user);
  }

  @Get(':type')
  @SkipEnvelope()
  async run(
    @Param('type', new ParseEnumPipe(REPORT_TYPES)) type: ReportType,
    @Query() q: ReportQueryDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { format, limit, ...filters } = q;
    if (format === 'json') {
      const report = await this.reports.run(type, filters, user, limit ?? 500);
      return { success: true, data: report };
    }

    if (!can(user, 'report.export'))
      throw Errors.forbidden('Exporting reports requires the report.export permission');
    const report = await this.reports.run(type, filters, user, format === 'pdf' ? 3000 : undefined);
    const { companyName } = await this.settings.get();
    const body =
      format === 'csv'
        ? toCsv(report)
        : format === 'xlsx'
          ? await toXlsx(report)
          : await toPdf(report, this.pdf, companyName);
    await this.activity.record({
      actorId: user.id,
      action: 'report.export',
      entityType: 'report',
      entityId: type,
      newValues: { format, filters: report.filters, rows: report.rows.length },
    });
    const date = report.generatedAt.slice(0, 10);
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${type}-report-${date}.${format}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(body);
  }
}
