import { OmitType, PartialType } from '@nestjs/swagger';
import { AssetCategory, AssetCondition, AssetStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
export const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;
export const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

const INITIAL_STATUSES = ['PURCHASED', 'REGISTERED', 'IN_STOCK'] as const;

export class CreateAssetDto {
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,31}$/, {
    message: 'assetTag must be 2-32 letters, digits or dashes',
  })
  assetTag?: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsUUID() assetTypeId!: string;

  @IsOptional()
  @Transform(trim)
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(128)
  serialNumber?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(128) serviceTag?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) brand?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) model?: string;
  @IsOptional() @IsObject() specifications?: Record<string, unknown>;

  @IsOptional() @IsIn(INITIAL_STATUSES) status?: (typeof INITIAL_STATUSES)[number];
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;

  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @Type(() => Date) @IsDate() purchaseDate?: Date;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999_999)
  purchaseCost?: number;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;

  @IsOptional() @IsUUID() warrantyProviderId?: string;
  @IsOptional() @Type(() => Date) @IsDate() warrantyStartDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() warrantyEndDate?: Date;
  @IsOptional() @IsString() @MaxLength(2000) warrantyCoverage?: string;
  @IsOptional() @IsString() @MaxLength(128) warrantyReference?: string;

  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

/** Status can only move between non-workflow statuses here (e.g. LOST → IN_STOCK when found). */
export class UpdateAssetDto extends PartialType(OmitType(CreateAssetDto, ['status'] as const)) {
  @IsOptional()
  @IsIn(['PURCHASED', 'REGISTERED', 'IN_STOCK', 'AVAILABLE'])
  status?: 'PURCHASED' | 'REGISTERED' | 'IN_STOCK' | 'AVAILABLE';
}

export class AssetQueryDto extends PaginationQueryDto {
  @IsOptional() @Transform(csv) @IsEnum(AssetStatus, { each: true }) status?: AssetStatus[];
  @IsOptional() @IsUUID() assetTypeId?: string;
  @IsOptional() @IsEnum(AssetCategory) category?: AssetCategory;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() purchaseId?: string;
  @IsOptional() @IsIn(['active', 'expiring', 'expired', 'none']) warranty?:
    'active' | 'expiring' | 'expired' | 'none';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) warrantyDays?: number;
}

export class RetireAssetDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
}

export class DisposeAssetDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) method!: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
  @IsOptional() @Type(() => Date) @IsDate() disposedAt?: Date;
}

export class ReportLostDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) notes!: string;
}
