import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { SettingsService } from './settings.service';

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
