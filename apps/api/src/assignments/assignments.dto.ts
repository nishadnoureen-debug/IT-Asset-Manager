import { AssetCondition, AssignmentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trim } from '../assets/assets.dto';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';

/** PNG data URL from the signature pad (max ~512 KB decoded). */
const SIGNATURE_MAX = 700_000;

export class AccessoryLineDto {
  @IsUUID() accessoryId!: string;
  @IsInt() @Min(1) @Max(100) quantity: number = 1;
}

export class AssignAssetDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @Type(() => Date) @IsDate() expectedReturnAt?: Date;
  @IsEnum(AssetCondition) condition!: AssetCondition;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AccessoryLineDto)
  accessories?: AccessoryLineDto[];

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Signature captured at hand-over; when present the assignment is acknowledged immediately. */
  @IsOptional() @IsString() @MaxLength(SIGNATURE_MAX) signature?: string;
}

export class ReturnAccessoryLineDto {
  @IsUUID() accessoryAssignmentId!: string;
  @IsBoolean() returned!: boolean;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
}

export class ReturnAssetDto {
  @IsEnum(AssetCondition) condition!: AssetCondition;
  /** Where the asset goes after return (spec: Returned → In Stock OR Repair). */
  @IsIn(['IN_STOCK', 'IN_REPAIR']) returnTo: 'IN_STOCK' | 'IN_REPAIR' = 'IN_STOCK';

  /** Lines for accessories handed over with the asset; omitted lines are treated as returned. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReturnAccessoryLineDto)
  accessories?: ReturnAccessoryLineDto[];

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(200) repairTitle?: string;
  @IsOptional() @IsString() @MaxLength(SIGNATURE_MAX) signature?: string;
}

export class TransferAssetDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
  @IsEnum(AssetCondition) condition!: AssetCondition;
  @IsOptional() @Type(() => Date) @IsDate() expectedReturnAt?: Date;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(SIGNATURE_MAX) signature?: string;
}

export class AcknowledgeDto {
  @IsOptional() @IsString() @MaxLength(SIGNATURE_MAX) signature?: string;
}

export class AssignmentQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(AssignmentStatus) status?: AssignmentStatus;
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unacknowledged?: boolean;
}
