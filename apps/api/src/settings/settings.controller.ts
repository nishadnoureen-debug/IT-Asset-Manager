import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FORM_SIGNATORIES_MAX } from '@itam/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SettingsService } from './settings.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class FormSignatoryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) title!: string;
  @Transform(trim) @IsString() @MaxLength(120) name!: string;
}

class UpdateSettingsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) companyName?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'defaultCurrency must be a 3-letter ISO code' })
  defaultCurrency?: string;

  @IsOptional()
  @Matches(/^[A-Z0-9]{1,10}$/, {
    message: 'assetTagPrefix must be 1-10 uppercase letters or digits',
  })
  assetTagPrefix?: string;

  @IsOptional() @IsInt() @Min(1) @Max(365) warrantyAlertDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) licenseAlertDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(60) maintenanceDueDays?: number;
  @IsOptional() @IsBoolean() allowSelfRegistration?: boolean;
  @IsOptional() @IsBoolean() registrationRequiresApproval?: boolean;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) formFooter?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) formTerms?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FORM_SIGNATORIES_MAX)
  @ValidateNested({ each: true })
  @Type(() => FormSignatoryDto)
  formSignatories?: FormSignatoryDto[];
}

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Readable by every signed-in user: the UI needs company name and currency. */
  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  @RequirePermissions('settings.edit')
  update(@Body() dto: UpdateSettingsDto, @CurrentUser() user: AuthUser) {
    return this.settings.update(dto, user.id);
  }
}
