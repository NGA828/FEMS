import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GisFeatureType, GpsSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
} from 'class-validator';

export class MapQueryDto {
  @ApiPropertyOptional({ enum: GisFeatureType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(GisFeatureType, { each: true })
  featureTypes?: GisFeatureType[];

  @ApiPropertyOptional({ description: 'Restrict to one forest' })
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional({ description: 'South-west corner latitude of the viewport' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  minLat?: number;

  @ApiPropertyOptional({ description: 'South-west corner longitude of the viewport' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  minLng?: number;

  @ApiPropertyOptional({ description: 'North-east corner latitude of the viewport' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  maxLat?: number;

  @ApiPropertyOptional({ description: 'North-east corner longitude of the viewport' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  maxLng?: number;

  @ApiPropertyOptional({ default: 500, maximum: 2000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit: number = 500;
}

export class NearbyQueryDto {
  @ApiProperty({ example: 3.848, description: 'Device latitude (-90..90)' })
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @ApiProperty({ example: 11.5021, description: 'Device longitude (-180..180)' })
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude!: number;

  @ApiPropertyOptional({ default: 50, description: 'Search radius in kilometres' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(500)
  radiusKm: number = 50;

  @ApiPropertyOptional({ enum: GisFeatureType, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(GisFeatureType, { each: true })
  featureTypes?: GisFeatureType[];

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 100;
}

export class RecordPositionDto {
  @ApiProperty({ example: 3.848, description: 'Latitude reported by the device GPS' })
  @Type(() => Number)
  @IsLatitude({ message: 'latitude must be between -90 and 90' })
  latitude!: number;

  @ApiProperty({ example: 11.5021 })
  @Type(() => Number)
  @IsLongitude({ message: 'longitude must be between -180 and 180' })
  longitude!: number;

  @ApiPropertyOptional({ example: 12.5, description: 'Horizontal accuracy in metres reported by the device' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyM?: number;

  @ApiPropertyOptional({ example: 640 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  elevationM?: number;

  @ApiPropertyOptional({ enum: GpsSource, default: GpsSource.DEVICE_GPS })
  @IsOptional()
  @IsEnum(GpsSource)
  source?: GpsSource;

  @ApiPropertyOptional({ example: 'Plot 14 — Mbalmayo' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  label?: string;

  @ApiPropertyOptional({ description: 'Field session this position belongs to' })
  @IsOptional()
  @IsUUID()
  fieldSessionId?: string;

  @ApiPropertyOptional({
    description:
      'Device timestamp of the fix (ISO 8601). Required when uploading a position captured offline.',
  })
  @IsOptional()
  @IsString()
  capturedAt?: string;

  @ApiPropertyOptional({ description: 'Set by offline clients to make retries idempotent' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRef?: string;

  @ApiPropertyOptional({ default: false, description: 'True when the position could not be verified (mock GPS)' })
  @IsOptional()
  @IsBoolean()
  mocked?: boolean;
}
