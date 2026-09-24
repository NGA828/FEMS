import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ProtectedAreaStatus,
  ProtectedAreaType,
  RiskLevel,
  TreeHealthStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ProtectedAreaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProtectedAreaType })
  @IsOptional()
  @IsEnum(ProtectedAreaType)
  type?: ProtectedAreaType;

  @ApiPropertyOptional({ enum: ProtectedAreaStatus })
  @IsOptional()
  @IsEnum(ProtectedAreaStatus)
  status?: ProtectedAreaStatus;

  @ApiPropertyOptional({ example: 'Centre' })
  @IsOptional()
  @IsString()
  region?: string;
}

export class CreateProtectedAreaDto {
  @ApiProperty({ example: 'RN-013' })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Réserve de faune du Dja' })
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  name!: string;

  @ApiProperty({ enum: ProtectedAreaType })
  @IsEnum(ProtectedAreaType)
  type!: ProtectedAreaType;

  @ApiPropertyOptional({ enum: ProtectedAreaStatus })
  @IsOptional()
  @IsEnum(ProtectedAreaStatus)
  status?: ProtectedAreaStatus;

  @ApiProperty({ example: 'Sud' })
  @IsString()
  @MaxLength(96)
  region!: string;

  @ApiProperty({ example: 526000 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  areaHa!: number;

  @ApiProperty({ example: 3.1 })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 13.2 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ description: 'GeoJSON Polygon boundary of the protected area' })
  @IsOptional()
  @IsObject()
  boundaryGeoJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '1987-05-15' })
  @IsOptional()
  @IsDateString()
  establishedAt?: string;

  @ApiPropertyOptional({ example: 'MINFOF — Délégation du Sud' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  managingAuthority?: string;

  @ApiPropertyOptional({ enum: RiskLevel, default: RiskLevel.LOW })
  @IsOptional()
  @IsEnum(RiskLevel)
  encroachmentRisk?: RiskLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'Habitat of the forest elephant and 14 endangered tree species.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  biodiversityNotes?: string;
}

export class UpdateProtectedAreaDto extends PartialType(CreateProtectedAreaDto) {}

export class SpeciesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only species protected by regulation' })
  @IsOptional()
  @IsBoolean()
  protectedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Only commercially harvested species' })
  @IsOptional()
  @IsBoolean()
  commercialOnly?: boolean;
}

export class CreateSpeciesDto {
  @ApiProperty({ example: 'Entandrophragma cylindricum' })
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  scientificName!: string;

  @ApiProperty({ example: 'Sapelli' })
  @IsString()
  @MinLength(2)
  @MaxLength(191)
  commonName!: string;

  @ApiPropertyOptional({ example: 'Meliaceae' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  familyName?: string;

  @ApiPropertyOptional({ example: 'Assié' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  localName?: string;

  @ApiPropertyOptional({ example: 'VU', description: 'IUCN Red List status' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  iucnStatus?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isCommercial?: boolean;

  @ApiPropertyOptional({ example: 80, description: 'Minimum harvestable diameter in cm' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxHarvestDiameterCm?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  minRotationYears?: number;

  @ApiPropertyOptional({ example: 620 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  woodDensityKgM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateSpeciesDto extends PartialType(CreateSpeciesDto) {}

export class InventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  speciesId?: string;

  @ApiPropertyOptional({ enum: TreeHealthStatus })
  @IsOptional()
  @IsEnum(TreeHealthStatus)
  healthStatus?: TreeHealthStatus;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  surveyedAfter?: string;
}

export class CreateInventoryDto {
  @ApiProperty()
  @IsUUID()
  forestId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiProperty()
  @IsUUID()
  speciesId!: string;

  @ApiProperty({ example: '2026-02-14' })
  @IsDateString()
  surveyDate!: string;

  @ApiProperty({ example: 'PLOT-14' })
  @IsString()
  @MaxLength(40)
  plotCode!: string;

  @ApiProperty({ example: 42 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  treesCounted!: number;

  @ApiPropertyOptional({ example: 61.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  averageDiameterCm?: number;

  @ApiPropertyOptional({ example: 28.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  averageHeightM?: number;

  @ApiPropertyOptional({ example: 182.6 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  volumeM3?: number;

  @ApiPropertyOptional({ example: 8.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  densityPerHa?: number;

  @ApiPropertyOptional({ enum: TreeHealthStatus, default: TreeHealthStatus.HEALTHY })
  @IsOptional()
  @IsEnum(TreeHealthStatus)
  healthStatus?: TreeHealthStatus;

  @ApiProperty({ example: 3.5167, description: 'Plot GPS latitude from the device' })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.5 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {}

export class ForestStatisticsQueryDto {
  @ApiPropertyOptional({ default: 12, description: 'Months of history for the trend series' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  months: number = 12;
}
