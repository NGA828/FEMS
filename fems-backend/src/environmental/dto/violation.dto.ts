import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GpsSource, ViolationSeverity, ViolationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
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
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ViolationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ViolationStatus })
  @IsOptional()
  @IsEnum(ViolationStatus)
  status?: ViolationStatus;

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
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observationId?: string;

  @ApiPropertyOptional({ description: 'Only cases recorded by this officer' })
  @IsOptional()
  @IsUUID()
  detectedById?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only cases whose remediation deadline has passed' })
  @IsOptional()
  @IsIn(['true', 'false'])
  overdueRemediation?: 'true' | 'false';

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreateViolationDto {
  @ApiProperty({ example: 'Harvest beyond the marked cutting area' })
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title!: string;

  @ApiProperty({
    example:
      'Two sapelli stumps were found about 40 m outside the boundary marks of the approved cutting area, with no corresponding entry in the harvest register.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ enum: ViolationSeverity })
  @IsEnum(ViolationSeverity)
  severity!: ViolationSeverity;

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

  @ApiPropertyOptional({ description: 'Inspection that documented the facts' })
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiPropertyOptional({ description: 'Observation that documented the facts' })
  @IsOptional()
  @IsUUID()
  observationId?: string;

  @ApiPropertyOptional({
    description: 'AI alert this case was opened from. Linking is always a human decision — an alert never opens a case by itself.',
  })
  @IsOptional()
  @IsUUID()
  aiAlertId?: string;

  @ApiProperty({ example: 3.848, description: 'Device position where the violation was documented' })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.502 })
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ example: 8.4 })
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

  @ApiPropertyOptional({ description: 'When the facts were documented' })
  @IsOptional()
  @IsDateString()
  detectedAt?: string;

  @ApiPropertyOptional({ example: 450000, description: 'Assessed damage in XAF' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  estimatedDamageXAF?: number;

  @ApiPropertyOptional({
    example: 900000,
    description: 'Penalty in XAF. May be set later, when the case is confirmed.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  penaltyAmountXAF?: number;

  @ApiPropertyOptional({ description: 'Whether the company must remediate the damage' })
  @IsOptional()
  @IsBoolean()
  remediationRequired?: boolean;

  @ApiPropertyOptional({ description: 'Deadline for remediation; defaults to the severity-based delay' })
  @IsOptional()
  @IsDateString()
  remediationDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remediationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  investigationNotes?: string;
}

export class UpdateViolationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: ViolationSeverity })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  estimatedDamageXAF?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  penaltyAmountXAF?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remediationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  remediationDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remediationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  investigationNotes?: string;
}

/** Body of `POST /violations/:id/actions/:action`. */
export class ViolationActionDto {
  @ApiPropertyOptional({
    example: 'Stumps measured on site and matched against the harvest register; the company was heard.',
    description: 'Justification. Required for CONFIRM, DISMISS, ESCALATE, RESOLVE and REOPEN.',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reason?: string;

  @ApiPropertyOptional({ enum: ViolationSeverity, description: 'Severity may be revised when the case is confirmed' })
  @IsOptional()
  @IsEnum(ViolationSeverity)
  severity?: ViolationSeverity;

  @ApiPropertyOptional({ example: 450000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  estimatedDamageXAF?: number;

  @ApiPropertyOptional({ example: 900000, description: 'Penalty set when the case is confirmed' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000000000)
  penaltyAmountXAF?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remediationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  remediationDeadline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remediationNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  investigationNotes?: string;

  @ApiPropertyOptional({
    description: 'Cancel the outstanding penalty with a written justification (regulators only)',
  })
  @IsOptional()
  @IsBoolean()
  waivePenalty?: boolean;
}
