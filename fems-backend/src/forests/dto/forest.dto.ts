import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ForestStatus, ForestType, ZoneStatus, ZoneType } from '@prisma/client';
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

export class ForestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ForestType })
  @IsOptional()
  @IsEnum(ForestType)
  type?: ForestType;

  @ApiPropertyOptional({ enum: ForestStatus })
  @IsOptional()
  @IsEnum(ForestStatus)
  status?: ForestStatus;

  @ApiPropertyOptional({ example: 'Centre' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Only forests that are publicly listed' })
  @IsOptional()
  @IsBoolean()
  publicOnly?: boolean;

  @ApiPropertyOptional({ description: 'Latitude of the search centre — sorts forests by distance' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  nearLatitude?: number;

  @ApiPropertyOptional({ description: 'Longitude of the search centre' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  nearLongitude?: number;
}

export class CreateForestDto {
  @ApiProperty({ example: 'UFA 10-012' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Unité Forestière d’Aménagement 10-012 — Mbalmayo' })
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  name!: string;

  @ApiProperty({ enum: ForestType })
  @IsEnum(ForestType)
  type!: ForestType;

  @ApiPropertyOptional({ enum: ForestStatus, default: ForestStatus.ACTIVE })
  @IsOptional()
  @IsEnum(ForestStatus)
  status?: ForestStatus;

  @ApiProperty({ example: 'Centre' })
  @IsString()
  @MaxLength(96)
  region!: string;

  @ApiPropertyOptional({ example: 'Nyong et So’o' })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  division?: string;

  @ApiPropertyOptional({ example: 'Mbalmayo' })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  subdivision?: string;

  @ApiProperty({ example: 25300.5, description: 'Total area in hectares' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  totalAreaHa!: number;

  @ApiPropertyOptional({ example: 18400 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exploitableAreaHa?: number;

  @ApiProperty({ example: 3.5167, description: 'Real coordinates — never a hardcoded default' })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.5 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({
    description: 'GeoJSON Polygon of the forest boundary ({"type":"Polygon","coordinates":[[[lng,lat],…]]})',
  })
  @IsOptional()
  @IsObject()
  boundaryGeoJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 640 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  elevationM?: number;

  @ApiPropertyOptional({ example: 78000, description: 'Annual allowable cut in m³' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  annualAllowableCutM3?: number;

  @ApiPropertyOptional({ example: '2008-06-01' })
  @IsOptional()
  @IsDateString()
  establishedAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  managedById?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  protectedAreaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateForestDto extends PartialType(CreateForestDto) {}

export class ZoneQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ZoneType })
  @IsOptional()
  @IsEnum(ZoneType)
  zoneType?: ZoneType;

  @ApiPropertyOptional({ enum: ZoneStatus })
  @IsOptional()
  @IsEnum(ZoneStatus)
  status?: ZoneStatus;

  @ApiPropertyOptional({ description: 'Only zones flagged as protected/conservation' })
  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;
}

export class CreateZoneDto {
  @ApiProperty({ example: 'Z-03' })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Parcelle 03 — série de production' })
  @IsString()
  @MinLength(2)
  @MaxLength(191)
  name!: string;

  @ApiProperty({ enum: ZoneType })
  @IsEnum(ZoneType)
  zoneType!: ZoneType;

  @ApiPropertyOptional({ enum: ZoneStatus })
  @IsOptional()
  @IsEnum(ZoneStatus)
  status?: ZoneStatus;

  @ApiProperty({ example: 1250.75 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  areaHa!: number;

  @ApiProperty({ example: 3.52 })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.51 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ description: 'GeoJSON Polygon boundary of the zone' })
  @IsOptional()
  @IsObject()
  boundaryGeoJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 4200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxAnnualYieldM3?: number;

  @ApiPropertyOptional({ example: 2, description: '0 = none, 3 = highest conservation priority' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  conservationPriority?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}
