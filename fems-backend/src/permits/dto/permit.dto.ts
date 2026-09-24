import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  DocumentType,
  PermitPriority,
  PermitStatus,
  PermitType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class PermitQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PermitStatus })
  @IsOptional()
  @IsEnum(PermitStatus)
  status?: PermitStatus;

  @ApiPropertyOptional({ enum: PermitType })
  @IsOptional()
  @IsEnum(PermitType)
  type?: PermitType;

  @ApiPropertyOptional({ enum: PermitPriority })
  @IsOptional()
  @IsEnum(PermitPriority)
  priority?: PermitPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Only permits awaiting action from the calling user' })
  @IsOptional()
  @IsBoolean()
  awaitingMyAction?: boolean;

  @ApiPropertyOptional({ description: 'Only permits expiring within this many days', example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiringWithinDays?: number;
}

export class CreatePermitDto {
  @ApiProperty({ enum: PermitType })
  @IsEnum(PermitType)
  type!: PermitType;

  @ApiProperty({ example: 'Exploitation of 3 500 m³ of sapelli — UFA 10-012' })
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title!: string;

  @ApiPropertyOptional({ example: 'Selective logging of the 2026 annual cut.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  purpose?: string;

  @ApiPropertyOptional({ enum: PermitPriority, default: PermitPriority.NORMAL })
  @IsOptional()
  @IsEnum(PermitPriority)
  priority?: PermitPriority;

  @ApiPropertyOptional({
    description: 'Only officers may file a permit on behalf of a company; company accounts are always scoped to their own company.',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty()
  @IsUUID()
  forestId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiProperty({ example: 3500, description: 'Volume requested in cubic metres' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000000)
  volumeRequestedM3!: number;

  @ApiPropertyOptional({ example: 1250.5, description: 'Concession area in hectares' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  areaRequestedHa?: number;

  @ApiPropertyOptional({ example: 2500, description: 'Royalty per m³ in XAF (used to pre-compute the fee)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  royaltyRatePerM3?: number;

  @ApiPropertyOptional({ example: 8750000, description: 'Fee amount in XAF; defaults to volume × royalty' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  feeAmount?: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ description: 'Operational conditions attached to the permit (free text)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conditions?: string;
}

export class UpdatePermitDto extends PartialType(CreatePermitDto) {}

export class PermitDecisionDto {
  @ApiPropertyOptional({ example: 3200, description: 'Approved volume (approve only); defaults to the requested volume' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  volumeApprovedM3?: number;

  @ApiPropertyOptional({ description: 'Mandatory for rejection, suspension, revocation and revision requests.' })
  @ValidateIf((dto: PermitDecisionDto) => dto.reason !== undefined)
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ example: '2026-06-30', description: 'Optional end date adjustment when approving' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Additional conditions attached at approval time' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  conditions?: string;
}

export class RenewPermitDto {
  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 3300 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  volumeRequestedM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class PermitDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;
}

export class CreatePermitDocumentDto {
  @ApiProperty({ enum: DocumentType })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiProperty({ example: 'Management plan — UFA 10-012' })
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  title!: string;

  @ApiProperty({ description: 'fileKey returned by POST /files/upload?folder=permits/documents' })
  @IsString()
  @MaxLength(255)
  fileKey!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @ApiProperty({ example: 245761 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiPropertyOptional({ description: 'SHA-256 returned by the upload endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class VerifyPermitDocumentDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isVerified!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
