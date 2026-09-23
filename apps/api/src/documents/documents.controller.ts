import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator';
import { Errors } from '../common/errors';
import { DocumentsService } from './documents.service';

class DocumentOwnerDto {
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @IsUUID() assignmentId?: string;
  @IsOptional() @IsUUID() maintenanceId?: string;
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsUUID() softwareLicenseId?: string;
  @IsOptional() @IsUUID() assetRequestId?: string;
  @IsOptional() @IsUUID() auditSessionId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
}

class UploadDocumentDto extends DocumentOwnerDto {
  @IsEnum(DocumentType) type!: DocumentType;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}

const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Query() owner: DocumentOwnerDto, @CurrentUser() user: AuthUser) {
    return this.documents.list(owner, user);
  }

  @Post()
  @RequirePermissions('document.upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw Errors.badRequest('A file is required', 'file');
    return this.documents.upload(file, dto, user);
  }

  @Get(':id/download')
  @SkipEnvelope()
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { doc, body } = await this.documents.download(id, user);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.originalFileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(body);
  }

  @Delete(':id')
  @RequirePermissions('document.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documents.remove(id, user);
  }
}
