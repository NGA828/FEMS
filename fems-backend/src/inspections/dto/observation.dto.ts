import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EvidenceSource, EvidenceType, GpsSource, ObservationCategory, ViolationSeverity } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ObservationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ObservationCategory })
  @IsOptional()
  @IsEnum(ObservationCategory)
  category?: ObservationCategory;

  @ApiPropertyOptional({ enum: ViolationSeverity })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observedById?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreateObservationDto {
  @ApiProperty({ enum: ObservationCategory })
  @IsEnum(ObservationCategory)
  category!: ObservationCategory;

  @ApiProperty({ example: 'Fresh stump outside the marked cutting area' })
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title!: string;

  @ApiProperty({ example: 'Two stumps of sapelli found about 40 m beyond the boundary marks.' })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;

  @ApiProperty()
  @IsUUID()
  forestId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  protectedAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional({ enum: ViolationSeverity, default: ViolationSeverity.LOW })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;

  @ApiProperty({ example: 3.848, description: 'Device position captured where the observation was made' })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.502 })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ example: 9.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  locationAccuracyM?: number;

  @ApiPropertyOptional({ enum: GpsSource, default: GpsSource.DEVICE_GPS })
  @IsOptional()
  @IsEnum(GpsSource)
  gpsSource?: GpsSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @ApiPropertyOptional({ description: 'Offline idempotency key for queue replay' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  clientRef?: string;
}

export class UpdateObservationDto {
  @ApiPropertyOptional({ enum: ObservationCategory })
  @IsOptional()
  @IsEnum(ObservationCategory)
  category?: ObservationCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: ViolationSeverity })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;
}

/**
 * Offline record. Coordinates use plain numeric validators here on purpose:
 * the service range-checks each record individually so a single bad capture is
 * reported as REJECTED instead of failing the whole batch with a 400.
 */
export class ObservationSyncRecordDto {
  @ApiProperty({ description: 'Stable idempotency key from the device' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  clientRef!: string;

  @ApiProperty({ enum: ObservationCategory })
  @IsEnum(ObservationCategory)
  category!: ObservationCategory;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;

  @ApiProperty()
  @IsUUID()
  forestId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional({ enum: ViolationSeverity })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  locationAccuracyM?: number;

  @ApiPropertyOptional({ enum: GpsSource })
  @IsOptional()
  @IsEnum(GpsSource)
  gpsSource?: GpsSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}

export class ObservationSyncDto {
  @ApiProperty({ type: [ObservationSyncRecordDto], description: 'Observation captured offline (max 100 per batch)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ObservationSyncRecordDto)
  records!: ObservationSyncRecordDto[];
}

export class AttachEvidenceDto {
  @ApiProperty({ enum: EvidenceType })
  @IsEnum(EvidenceType)
  type!: EvidenceType;

  @ApiPropertyOptional({ enum: EvidenceSource, default: EvidenceSource.FILE_UPLOAD })
  @IsOptional()
  @IsEnum(EvidenceSource)
  source?: EvidenceSource;

  @ApiProperty({ description: 'Storage key returned by POST /files/upload', example: 'evidence/20260924/<uuid>.jpg' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  fileKey!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  mimeType!: string;

  @ApiProperty({ example: 245120, description: 'File size in bytes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(104857600)
  sizeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  violationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  locationAccuracyM?: number;

  @ApiPropertyOptional({ enum: GpsSource })
  @IsOptional()
  @IsEnum(GpsSource)
  gpsSource?: GpsSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
