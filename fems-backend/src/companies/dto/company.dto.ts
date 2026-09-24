import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CompanyStatus, CompanyType, DocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Société Forestière du Sud SARL' })
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  name!: string;

  @ApiProperty({ example: 'RC/DLA/2019/B/1234' })
  @IsString()
  @MaxLength(64)
  registrationNumber!: string;

  @ApiPropertyOptional({ example: 'M071234567890' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxNumber?: string;

  @ApiProperty({ enum: CompanyType, example: CompanyType.LOGGING_COMPANY })
  @IsEnum(CompanyType)
  type!: CompanyType;

  @ApiProperty({ example: 'contact@sfs.cm' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+237222314455' })
  @Matches(/^\+?[0-9\s-]{8,20}$/)
  phone!: string;

  @ApiPropertyOptional({ example: '+237677445566' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/)
  alternatePhone?: string;

  @ApiProperty({ example: 'Rue 1.234, Bastos' })
  @IsString()
  @MaxLength(255)
  addressLine!: string;

  @ApiProperty({ example: 'Yaoundé' })
  @IsString()
  @MaxLength(96)
  city!: string;

  @ApiProperty({ example: 'Centre', description: 'Cameroon region' })
  @IsString()
  @MaxLength(96)
  region!: string;

  @ApiPropertyOptional({ default: 'Cameroun' })
  @IsOptional()
  @IsString()
  @MaxLength(96)
  country?: string;

  @ApiPropertyOptional({ example: 'https://sfs.cm' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  website?: string;

  @ApiPropertyOptional({ example: 3.848 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 11.5021 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 145 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  employeeCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class VerifyCompanyDto {
  @ApiPropertyOptional({ default: true, description: 'true = approve, false = reject' })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional({ example: 'Registration certificate verified against MINFOF records.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: 'Tax clearance certificate expired.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class SuspendCompanyDto {
  @ApiProperty({ example: 'Operating outside the approved permit area' })
  @IsString()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ enum: CompanyStatus, default: CompanyStatus.SUSPENDED })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;
}

export class CompanyQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;

  @ApiPropertyOptional({ enum: CompanyType })
  @IsOptional()
  @IsEnum(CompanyType)
  type?: CompanyType;

  @ApiPropertyOptional({ example: 'Centre' })
  @IsOptional()
  @IsString()
  region?: string;
}

export class CreateCompanyDocumentDto {
  @ApiProperty({ enum: DocumentType, example: DocumentType.COMPANY_REGISTRATION })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiProperty({ example: 'Registre de commerce 2024' })
  @IsString()
  @MaxLength(191)
  title!: string;

  @ApiProperty({ description: 'fileKey returned by POST /files/upload' })
  @IsString()
  @MaxLength(255)
  fileKey!: string;

  @ApiPropertyOptional({
    example: '/api/v1/files/download?key=companies/documents/2026-01-04/uuid.pdf',
    description: 'Download URL; derived from fileKey when omitted.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  fileUrl?: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @ApiProperty({ example: 284411 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @ApiPropertyOptional({ description: 'SHA-256 checksum returned by the upload endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;

  @ApiPropertyOptional({ example: '2026-01-15', description: 'Document issue date' })
  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @ApiPropertyOptional({ example: '2027-01-15', description: 'Document expiry date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class VerifyDocumentDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isVerified!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CompanyDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  isVerified?: string;
}

export class NearbyCompanyQueryDto {
  @ApiProperty({ example: 3.848 })
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: 11.5021 })
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm: number = 100;
}

export class CompanyMemberDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;
}
