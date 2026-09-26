import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MediaOwnerType, MediaRole } from '@prisma/client';

export class MediaQueryDto {
  @ApiPropertyOptional({ enum: MediaOwnerType })
  @IsOptional()
  @IsEnum(MediaOwnerType)
  ownerType?: MediaOwnerType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;

  /** Comma separated owner ids for batch cover lookups. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerIds?: string;

  @ApiPropertyOptional({ enum: MediaRole })
  @IsOptional()
  @IsEnum(MediaRole)
  role?: MediaRole;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
