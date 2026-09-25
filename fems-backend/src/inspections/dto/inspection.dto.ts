import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ChecklistResult,
  GpsSource,
  InspectionOutcome,
  InspectionStatus,
  InspectionType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export class InspectionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InspectionStatus })
  @IsOptional()
  @IsEnum(InspectionStatus)
  status?: InspectionStatus;

  @ApiPropertyOptional({ enum: InspectionType })
  @IsOptional()
  @IsEnum(InspectionType)
  type?: InspectionType;

  @ApiPropertyOptional({ enum: InspectionOutcome })
  @IsOptional()
  @IsEnum(InspectionOutcome)
  outcome?: InspectionOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional({ description: 'Filter by assigned inspector' })
  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @ApiPropertyOptional({ description: 'Only inspections assigned to the calling officer' })
  @IsOptional()
  @IsString()
  mine?: 'true' | 'false';

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ChecklistItemDto {
  @ApiProperty({ example: 'ROU-01' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Permit displayed and valid on site' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  label!: string;

  @ApiPropertyOptional({ enum: ChecklistResult, default: ChecklistResult.NOT_APPLICABLE })
  @IsOptional()
  @IsEnum(ChecklistResult)
  result?: ChecklistResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class CreateInspectionDto {
  @ApiProperty({ enum: InspectionType })
  @IsEnum(InspectionType)
  type!: InspectionType;

  @ApiProperty({ example: 'Routine inspection of UFA 10-012 annual cut' })
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title!: string;

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
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional({ description: 'Officer assigned to carry out the inspection' })
  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @ApiPropertyOptional({ example: '2026-10-05T08:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @ApiPropertyOptional({ type: [ChecklistItemDto], description: 'Defaults to the checklist template of the inspection type' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

export class UpdateInspectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recommendations?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectorId?: string;

  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}

/** Device GPS position, captured on site — never invented by the app. */
export class FieldPositionDto {
  @ApiProperty({ example: 3.848 })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.502 })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ example: 8.5, description: 'Horizontal accuracy in metres as reported by the device' })
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
  gpsCapturedAt?: string;
}

export class StartInspectionDto extends FieldPositionDto {}

export class SubmitInspectionDto extends FieldPositionDto {
  @ApiProperty({ enum: InspectionOutcome })
  @IsEnum(InspectionOutcome)
  outcome!: InspectionOutcome;

  @ApiPropertyOptional({ description: 'Site summary written by the inspector' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recommendations?: string;

  @ApiPropertyOptional({ type: [ChecklistItemDto], description: 'Checklist results; every item must be answered' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];

  @ApiPropertyOptional({ description: 'Volume actually verified on site (m³)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000)
  verifiedHarvestedVolumeM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  verifiedTreeCount?: number;

  @ApiPropertyOptional({ description: 'Differences found between declarations and field reality' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  discrepancies?: string;

  @ApiPropertyOptional({ description: 'Offline idempotency key: replaying a submission returns the stored report' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  clientRef?: string;
}

export class ReviewInspectionDto {
  @ApiPropertyOptional({ enum: InspectionOutcome, description: 'Reviewer may correct the outcome' })
  @IsOptional()
  @IsEnum(InspectionOutcome)
  outcome?: InspectionOutcome;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  recommendations?: string;
}

export class CancelInspectionDto {
  @ApiPropertyOptional({
    example: 'Access road flooded after heavy rain',
    description: 'Required by the inspection state machine when cancelling',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;
}
