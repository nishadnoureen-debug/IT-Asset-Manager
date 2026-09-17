import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { SortOrder } from '@itam/shared';

export const MAX_PAGE_SIZE = 100;

/**
 * Base query DTO for list endpoints. Feature modules extend it with their own filters and must
 * whitelist `sortBy` against known columns before passing it to Prisma.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Field to sort by' })
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: SortOrder = 'desc';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
